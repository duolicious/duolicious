import torch
import torch.nn as nn
import torch.nn.functional as F

from kvmatching.features import Batch, N_COUNTRIES, TensorFeatures


def one_hot_cats(cat: torch.Tensor, sizes: list[int]) -> torch.Tensor:
    return torch.cat(
        [F.one_hot(cat[:, i], s).float() for i, s in enumerate(sizes)], dim=1)


class Noise:
    def __init__(self, p_answer: float, p_cat: float, p_pref: float,
                 p_year: float = 0.0, p_beh: float = 0.0,
                 p_prof: float = 0.0) -> None:
        self.p_answer = p_answer
        self.p_cat = p_cat
        self.p_pref = p_pref
        self.p_year = p_year
        self.p_beh = p_beh
        self.p_prof = p_prof


def drop(x: torch.Tensor, p: float) -> torch.Tensor:
    if p <= 0:
        return x
    keep = (torch.rand_like(x) >= p).float()
    return x * keep


class MLP(nn.Module):
    def __init__(self, dims: list[int], dropout: float = 0.0) -> None:
        super().__init__()
        layers: list[nn.Module] = []
        for i in range(len(dims) - 1):
            layers.append(nn.Linear(dims[i], dims[i + 1]))
            if i < len(dims) - 2:
                layers.append(nn.LayerNorm(dims[i + 1]))
                layers.append(nn.ReLU())
                layers.append(nn.Dropout(dropout))
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class WhoDVAE(nn.Module):
    """Denoising VAE over stable profile data: answers, basics, location,
    country, behaviour, profile quality. Latent dimension `m`. The decoder
    is a single linear map: serving only ever uses the latent through inner
    products, and reconstructing through a linear head regularises it into
    exactly that shape."""

    def __init__(self, tf: TensorFeatures, m: int, hidden: int, layers: int,
                 noise: Noise, dropout: float) -> None:
        super().__init__()
        self.tf = tf
        self.m = m
        self.noise = noise
        self.nq = tf.answers.shape[1]
        self.cat_sizes = tf.cat_sizes
        self.in_dim = (self.nq + sum(self.cat_sizes) + 4 + tf.loc.shape[1]
                       + N_COUNTRIES + tf.beh.shape[1] + tf.prof.shape[1])
        self.enc = MLP([self.in_dim] + [hidden] * layers, dropout)
        self.mu = nn.Linear(hidden, m)
        self.logvar = nn.Linear(hidden, m)
        self.bias = nn.Linear(hidden, 1)
        self.out_dim = (self.nq + sum(self.cat_sizes) + 2 + tf.loc.shape[1]
                        + N_COUNTRIES)
        self.head = nn.Linear(m, self.out_dim)

    def build_input(self, b: Batch, train: bool) -> torch.Tensor:
        ans = b["answers"]
        cat = b["cat"]
        num = b["num"]
        if train:
            ans = drop(ans, self.noise.p_answer)
            if self.noise.p_cat > 0:
                keep = torch.rand(cat.shape, device=cat.device) >= self.noise.p_cat
                cat = torch.where(keep, cat, torch.ones_like(cat))
            if self.noise.p_year > 0:
                hit = (torch.rand(num.shape[0], device=num.device)
                       < self.noise.p_year).float()
                sign = torch.randint(
                    0, 2, (num.shape[0],), device=num.device).float() * 2 - 1
                num = num.clone()
                num[:, 0] = num[:, 0] + hit * sign * 0.1
        beh = b["beh"]
        if train and self.noise.p_beh > 0:
            # Zero the whole block at once: an all-zero block is exactly a
            # brand-new user, so the encoder keeps working before anyone has
            # messaged. Trained without this, the model over-trusts the
            # behaviour signals and generalises measurably worse.
            keep = (torch.rand(beh.shape[0], 1, device=beh.device)
                    >= self.noise.p_beh).float()
            beh = beh * keep
        prof = b["prof"]
        if train and self.noise.p_prof > 0:
            keep = (torch.rand(prof.shape[0], 1, device=prof.device)
                    >= self.noise.p_prof).float()
            prof = prof * keep
        parts = [
            ans,
            one_hot_cats(cat, self.cat_sizes),
            num * b["num_mask"], b["num_mask"],
            b["loc"],
            F.one_hot(b["country"], N_COUNTRIES).float(),
            beh,
            prof,
        ]
        return torch.cat(parts, dim=1)

    def encode(self, b: Batch, train: bool) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.enc(self.build_input(b, train))
        return self.mu(h), self.logvar(h)

    def encode_with_bias(self, b: Batch, train: bool) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.enc(self.build_input(b, train))
        return self.mu(h), self.bias(h).squeeze(1)

    def recon_loss(self, z: torch.Tensor, b: Batch) -> dict[str, torch.Tensor]:
        return self.split_losses(self.head(z), b)

    def split_losses(self, out: torch.Tensor, b: Batch) -> dict[str, torch.Tensor]:
        losses: dict[str, torch.Tensor] = {}
        o = 0
        ans_logit = out[:, o:o + self.nq]; o += self.nq
        ans = b["answers"]
        answered = (ans != 0).float()
        bce = F.binary_cross_entropy_with_logits(
            ans_logit, (ans > 0).float(), reduction="none")
        losses["answers"] = (bce * answered).sum() / answered.sum().clamp(min=1)
        cat_ce = []
        for i, s in enumerate(self.cat_sizes):
            logit = out[:, o:o + s]; o += s
            cat_ce.append(F.cross_entropy(logit, b["cat"][:, i]))
        losses["cat"] = torch.stack(cat_ce).mean()
        num = out[:, o:o + 2]; o += 2
        mse = (num - b["num"]) ** 2 * b["num_mask"]
        losses["num"] = mse.sum() / b["num_mask"].sum().clamp(min=1)
        nl = b["loc"].shape[1]
        loc = out[:, o:o + nl]; o += nl
        losses["loc"] = F.mse_loss(loc, b["loc"])
        country = out[:, o:o + N_COUNTRIES]; o += N_COUNTRIES
        losses["country"] = F.cross_entropy(country, b["country"])
        return losses


class LookDVAE(WhoDVAE):
    """Same as WhoDVAE plus search preferences; latent dimension m + n. The
    first m dims live in the same space as WhoDVAE's latent."""

    def __init__(self, tf: TensorFeatures, m: int, n: int, hidden: int,
                 layers: int, noise: Noise, dropout: float) -> None:
        super().__init__(tf, m, hidden, layers, noise, dropout)
        self.n = n
        self.pref_multi_sizes = tf.pref_multi_sizes
        self.npn = tf.pref_num.shape[1]
        self.ntw = tf.pref_two_way.shape[1]
        extra_in = (self.nq + sum(self.pref_multi_sizes) + 2 * self.npn + self.ntw)
        extra_out = (self.nq + sum(self.pref_multi_sizes) + self.npn + self.ntw)
        self.in_dim += extra_in
        self.out_dim += extra_out
        self.enc = MLP([self.in_dim] + [hidden] * layers, dropout)
        self.mu = nn.Linear(hidden, m + n)
        self.logvar = nn.Linear(hidden, m + n)
        self.bias = nn.Linear(hidden, 1)
        self.head = nn.Linear(m + n, self.out_dim)

    def build_input(self, b: Batch, train: bool) -> torch.Tensor:
        base = super().build_input(b, train)
        pa = b["pref_answers"]
        pm = b["pref_multi"]
        if train:
            pa = drop(pa, self.noise.p_pref)
            pm = drop(pm, self.noise.p_pref)
        parts = [
            base, pa, pm,
            b["pref_num"] * b["pref_num_mask"], b["pref_num_mask"],
            b["pref_two_way"],
        ]
        return torch.cat(parts, dim=1)

    def split_losses(self, out: torch.Tensor, b: Batch) -> dict[str, torch.Tensor]:
        base_dim = self.out_dim - (
            self.nq + sum(self.pref_multi_sizes) + self.npn + self.ntw)
        losses = super().split_losses(out[:, :base_dim], b)
        o = base_dim
        pa_logit = out[:, o:o + self.nq]; o += self.nq
        pa = b["pref_answers"]
        set_ = (pa != 0).float()
        bce = F.binary_cross_entropy_with_logits(
            pa_logit, (pa > 0).float(), reduction="none")
        losses["pref_answers"] = (bce * set_).sum() / set_.sum().clamp(min=1)
        pm = b["pref_multi"]
        npm = pm.shape[1]
        pm_logit = out[:, o:o + npm]; o += npm
        losses["pref_multi"] = F.binary_cross_entropy_with_logits(pm_logit, pm)
        pn = out[:, o:o + self.npn]; o += self.npn
        mse = (pn - b["pref_num"]) ** 2 * b["pref_num_mask"]
        losses["pref_num"] = mse.sum() / b["pref_num_mask"].sum().clamp(min=1)
        tw = out[:, o:o + self.ntw]; o += self.ntw
        losses["pref_two_way"] = F.binary_cross_entropy_with_logits(
            tw, b["pref_two_way"])
        return losses


def kl(mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
    return (-0.5 * (1 + logvar - mu ** 2 - logvar.exp()).sum(dim=1)).mean()


def reparam(mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
    return mu + torch.randn_like(mu) * (0.5 * logvar).exp()


class KVModel(nn.Module):
    def __init__(self, tf: TensorFeatures, m: int, n: int, hidden: int,
                 layers: int, noise: Noise, dropout: float) -> None:
        super().__init__()
        self.m = m
        self.who = WhoDVAE(tf, m, hidden, layers, noise, dropout)
        self.look = LookDVAE(tf, m, n, hidden, layers, noise, dropout)

    def who_vec(self, b: Batch, train: bool) -> tuple[torch.Tensor, torch.Tensor]:
        mu, bias = self.who.encode_with_bias(b, train)
        return mu, bias

    def look_vec(self, b: Batch, train: bool) -> tuple[torch.Tensor, torch.Tensor]:
        mu, bias = self.look.encode_with_bias(b, train)
        return mu[:, :self.m], bias
