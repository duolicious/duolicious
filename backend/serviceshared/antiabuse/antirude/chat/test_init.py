import unittest
from serviceshared.antiabuse.antirude.chat import is_rude

class TestIsOffensive(unittest.TestCase):

    def test_rude_strings(self) -> None:
        self.assertTrue(is_rude("you will never b a woman"))

        # Results are invariant to adjective use
        self.assertTrue(is_rude("your beautiful, cute little h0le is very very inviting :)"))

        self.assertTrue(is_rude("gonna make u chke on me 2nite"))

        self.assertTrue(is_rude("gib milkies pls"))

        self.assertTrue(is_rude("nice milkers bro mind if i have a sip"))

        self.assertTrue(is_rude("pls touch my pp"))

        self.assertTrue(is_rude("mommy can you please sit on me"))

        self.assertTrue(is_rude("you will let me call you the n word while i smash"))

        self.assertTrue(is_rude("I'm gonna end my own life"))

        self.assertTrue(is_rude("let me have my way with ur mouth n make u swallow it all"))

        self.assertTrue(is_rude("can i pls cmm in iuuu"))

        self.assertTrue(is_rude("ur tiddies look nice"))

        self.assertTrue(is_rude("ill ruin u while u wear cosplay"))

        self.assertTrue(is_rude("pls pls pls let me flck ur cute mouth"))

        self.assertTrue(is_rude("you gotta lemme hit"))

        self.assertTrue(is_rude("do you like being choked?"))

        self.assertTrue(is_rude("be my little cumslut"))

        self.assertTrue(is_rude("nice funbags"))

        self.assertTrue(is_rude("hi. can i impregnate you gently?"))

        self.assertTrue(is_rude("ur gonna get slutted out"))

        self.assertTrue(is_rude("lemme stretch you out"))

        self.assertTrue(is_rude("imma gape it, baby"))

        self.assertTrue(is_rude("hi could i put my feet on your face"))

        self.assertTrue(is_rude("hi could you put your feet on my face"))

        self.assertTrue(is_rude("how tight is it"))

        self.assertTrue(is_rude("can i p33 on your face"))

        self.assertTrue(is_rude("lets rvpe each other"))

        self.assertTrue(is_rude("Can I jerk off to your selfie"))

        self.assertTrue(is_rude("you deserve to be ass fucked hard"))

        self.assertTrue(is_rude("so you take it up the ass"))

        self.assertTrue(is_rude("id enter that ass everyday"))

        self.assertTrue(is_rude("let me gobble your ass"))

        self.assertTrue(is_rude("you have a very nice ašŝ 😊"))

        self.assertTrue(is_rude("im not fact checking your shit just your ass cheeks"))

        self.assertTrue(is_rude("that's a fat ass"))

        self.assertTrue(is_rude("lemme eat that ass"))

        self.assertTrue(is_rude("u gon git 🍇ed"))

        self.assertTrue(is_rude("masterbation"))

        self.assertTrue(is_rude("masturbation"))

        self.assertTrue(is_rude("masterbate"))

        self.assertTrue(is_rude("masturbate"))

        self.assertTrue(is_rude("can i rub my tongue ur piercings"))

        self.assertTrue(is_rude("very creampieable"))

        self.assertTrue(is_rude("can i finish in u"))

        self.assertTrue(is_rude("id love to finish in ur cookie"))

        self.assertTrue(is_rude("i rlly rlly wanna fill u"))

        self.assertTrue(is_rude("i would love to pound ur cute mouth darling"))

        self.assertTrue(is_rude("can i pls have my way w u"))

        self.assertTrue(is_rude("can i finish on your face"))

        self.assertTrue(is_rude("id love to pound you"))

        self.assertTrue(is_rude("can we have esex?"))

        self.assertTrue(is_rude("can we have e sex?"))

        self.assertTrue(is_rude("nig"))

        self.assertTrue(is_rude("niggg"))

        self.assertTrue(is_rude("ni99er"))

        self.assertTrue(is_rude("how big is that dih"))

        self.assertTrue(is_rude("selfharm"))

        self.assertTrue(is_rude("self harming"))

        self.assertTrue(is_rude("self-harming"))

        self.assertTrue(is_rude("make y0u cxm all ovdr"))

        self.assertTrue(is_rude("i would put it s0 far d33p inside y0u"))

        self.assertTrue(is_rude("let me put it d33p 1nside you"))

        self.assertTrue(is_rude("do you want to get graped?"))

        self.assertTrue(is_rude("fuk your as$"))

        self.assertTrue(is_rude("go fk y0urself please"))

        self.assertTrue(is_rude("go fk urself please"))

        self.assertTrue(is_rude("GO FK URSELF PLEASE"))

        self.assertTrue(is_rude("I want to cvm on u"))

        self.assertTrue(is_rude("I'm cumming"))

        self.assertTrue(is_rude("I want to ccccuuummmm on u"))

        self.assertTrue(is_rude("You're a whore. Respectfully."))

        self.assertTrue(is_rude("Small dick energy"))

        self.assertTrue(is_rude("Small dik energy"))

        self.assertTrue(is_rude("Would you like to purchase viagra?"))

        # whore is rude even if followed by an emoji without space between
        self.assertTrue(is_rude("you are a wh0re🙂"))

        self.assertTrue(is_rude("you are a whore!"))

        # Homoglyph attacks. The letter "o" in "whоre" has been replaced with a
        # Cyrillic "о" (Unicode character U+043E), which looks identical to the
        # Latin "o" (Unicode character U+006F)
        self.assertTrue(is_rude("you filthy degеnerate pоrn addicted whоre !"))

        self.assertTrue(is_rude("I am the rapist"))

        self.assertTrue(is_rude("I am a p3d0"))

        self.assertTrue(is_rude("Wanna get piped down?"))

        self.assertTrue(is_rude("are you a tro0n?"))

        self.assertTrue(is_rude("I'm strokin it rn"))

        self.assertTrue(is_rude("uhhh let me grank in your a$$?"))

        self.assertTrue(is_rude("you ever seen a white boy stroke it insanely?"))

        self.assertTrue(is_rude("in gonna fly a drone into your cooter"))

        self.assertTrue(is_rude("be my big tiddy gf"))

        self.assertTrue(is_rude("Hey doll, you look positively rapable."))

        self.assertTrue(is_rude("you look rap4ble"))

        self.assertTrue(is_rude("you look rapeble"))

        self.assertTrue(is_rude("When did you last cum?"))

        self.assertTrue(is_rude("pen15"))

        self.assertTrue(is_rude("raype"))

        self.assertTrue(is_rude("a55 fk"))

        self.assertTrue(is_rude("𝖓𝖎𝖌𝖌𝖊𝖗"))

        self.assertTrue(is_rude("𝖓𝖎𝖌𝖌𝖊"))

        self.assertTrue(is_rude("unr4pe-able"))

        self.assertTrue(is_rude("s3lf h4rm"))

        self.assertTrue(is_rude("tr@nnies"))

        self.assertTrue(is_rude("tr@nny"))

        self.assertTrue(is_rude("niggreess"))

        self.assertTrue(is_rude("slūt"))

        self.assertTrue(is_rude("dyck"))

        self.assertTrue(is_rude("niga"))

        self.assertTrue(is_rude("wh0r3$"))

        self.assertTrue(is_rude("fo0tj0b$"))

        self.assertTrue(is_rude("fo0tj0b"))

        self.assertTrue(is_rude("tr00nz"))

        self.assertTrue(is_rude("r4p3d"))

        self.assertTrue(is_rude("b4ck sh0tz"))

        self.assertTrue(is_rude("bytch"))

        self.assertTrue(is_rude("btch"))

        self.assertTrue(is_rude("su1cide"))

        self.assertTrue(is_rude("pyss"))

        self.assertTrue(is_rude("b00bies"))

        self.assertTrue(is_rude("nigguhh"))

        self.assertTrue(is_rude("neggers"))

        self.assertTrue(is_rude("dike"))

        self.assertTrue(is_rude("d1k3"))

        self.assertTrue(is_rude("nyigger"))

        self.assertTrue(is_rude("nigguh"))

        self.assertTrue(is_rude("nyggr"))

        self.assertTrue(is_rude("nigg"))

        self.assertTrue(is_rude("fag0t"))

        self.assertTrue(is_rude("r@ping"))

        self.assertTrue(is_rude("rapng"))

        self.assertTrue(is_rude("an4l"))

        self.assertTrue(is_rude("nggrs"))

        self.assertTrue(is_rude("fаббoтs"))

        self.assertTrue(is_rude("ahole"))

        self.assertTrue(is_rude("ray ping"))

        self.assertTrue(is_rude("f00t job"))

    def test_non_rude_strings(self) -> None:
        self.assertFalse(is_rude("What puzzles do you enjoy"))

        # the :pp emoticon doesn't trigger a false positives
        self.assertFalse(
                is_rude("haha :pp"))

        # 'ass' is a very versatile word. While the word itself can be
        # considered offensive, we're mostly interested in filtering it when
        # it's used sexually.
        self.assertFalse(
                is_rude("that's a boring ass game"))

        self.assertFalse(
                is_rude("overwatch is ass fr fr"))

        self.assertFalse(
                is_rude("ngl thats some cute ass miku art"))

        self.assertFalse(
                is_rude("nuke enthusiast lookin ass"))

        self.assertFalse(
                is_rude("im being dead ass rn"))

        self.assertFalse(
                is_rude("it's a pain in the ass"))

        # `cm' (centimetres) isn't confused with `cmm` (cum)
        self.assertFalse(
                is_rude("only 5 cm taller than you"))

        # This shouldn't be confused with e-sex or 'e sex'
        self.assertFalse(
                is_rude("I live in essex"))

        # This shouldn't be confused with piss
        self.assertFalse(
                is_rude("plssss"))

        # This shouldn't be confused with piss
        self.assertFalse(
                is_rude("plzzzz"))

        # All doom shouldn't get interpreted as "dom"
        self.assertFalse(
                is_rude("doom is a fun game"))

        # dm shouldn't get interpreted as "dom"
        self.assertFalse(
                is_rude("I’ll DM you"))

        # `verb_forms_for_each` shouldn't include 'raper'
        self.assertFalse(
                is_rude("underground rappers"))

        # jet shouldn't get interpreted as "jeet"
        self.assertFalse(
                is_rude("jet black"))

        # Hell shouldn't be confused with heil
        self.assertFalse(
                is_rude("the hell"))

        # This shouldn't be confused with loli
        self.assertFalse(
                is_rude("lol!"))

        self.assertFalse(
                is_rude("lol"))

        self.assertFalse(
                is_rude("loll"))

        # This shouldn't be confused with "have my way with you"
        self.assertFalse(
                is_rude("I have my ways"))

        self.assertFalse(
                is_rude("I might finish in a week"))

        # False positives about being "used"
        self.assertFalse(
                is_rude("Use your words rather than physical aggression"))

        # kiss shouldn't get normalized to kys
        self.assertFalse(
                is_rude("im waiting for marriage to kiss you"))

        self.assertFalse(
                is_rude("Hey! You’re amazing, keep going."))

        self.assertFalse(
                is_rude("Jintai and K-On are pretty cute."))

        self.assertFalse(
                is_rude("She piped up after realizing that"))

        self.assertFalse(
                is_rude("go hug urself please"))

        self.assertFalse(
                is_rude("I respect you"))

        self.assertFalse(
                is_rude("""
I'd just like to interject for a moment. What you're refering to as Linux, is in fact, GNU/Linux, or as I've recently taken to calling it, GNU plus Linux. Linux is not an operating system unto itself, but rather another free component of a fully functioning GNU system made useful by the GNU corelibs, shell utilities and vital system components comprising a full OS as defined by POSIX.

Many computer users run a modified version of the GNU system every day, without realizing it. Through a peculiar turn of events, the version of GNU which is widely used today is often called Linux, and many of its users are not aware that it is basically the GNU system, developed by the GNU Project.

There really is a Linux, and these people are using it, but it is just a part of the system they use. Linux is the kernel: the program in the system that allocates the machine's resources to the other programs that you run. The kernel is an essential part of an operating system, but useless by itself; it can only function in the context of a complete operating system. Linux is normally used in combination with the GNU operating system: the whole system is basically GNU with Linux added, or GNU/Linux. All the so-called Linux distributions are really distributions of GNU/Linux!
        """))

        self.assertFalse(
                is_rude("Who're you listening to?"))

        self.assertFalse(
                is_rude("Can u c my pfp?"))

        self.assertFalse(
                is_rude("I am therapist"))

    # Using Cyrillic characters
    def test_cyrillic_substitution(self) -> None:
        # Substituting "a" with Cyrillic "а" (U+0430)
        self.assertTrue(is_rude("gаg me"))
        # Substituting "e" with Cyrillic "е" (U+0435)
        self.assertTrue(is_rude("gave mе head"))
        # Mixed Latin and Cyrillic characters
        self.assertTrue(is_rude("fuckаblе"))

    # Using Greek characters
    def test_greek_substitution(self) -> None:
        # Substituting "o" with Greek "ο" (U+03BF)
        self.assertTrue(is_rude("gοok"))
        # Substituting "i" with Greek "ι" (U+03B9)
        self.assertTrue(is_rude("gιmme head"))


if __name__ == '__main__':
    unittest.main()
