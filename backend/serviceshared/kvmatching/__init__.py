"""The matching model at serving time.

`backend/kvmatching` trains it and freezes the weights, with the feature
vocabulary they were fitted against, into `kv_model.npz`. This package turns
a person's database rows back into those features and runs the encoders over
them in numpy, so neither torch nor scipy reaches the backend; training
builds its own features with it too. Everyone comes out with a `value` (who
they are) and a `key` (what they are looking for), 66 dimensions each with
the desirability and eagerness scalars folded in, so one inner product of
someone's key against another's value scores "A is looking for B".
"""
