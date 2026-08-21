import unittest
from serviceshared.antiabuse.childsafety import potential_minor

class TestPotentialMinor(unittest.TestCase):

    def test_potential_minor(self) -> None:
        self.assertTrue(
                potential_minor("""
Hi

(I’m 17)
                """.strip()))
        self.assertTrue(
                potential_minor("""
Hi

(I’m sixteen)
                """.strip()))

        self.assertTrue(
                potential_minor("""
17m looking for friends
16f looking for friends
                """.strip()))

        self.assertTrue(
                potential_minor("""
15 soon sixteen
15 soon 16
                """.strip()))

        self.assertTrue(
                potential_minor("""
- into history
- into tf2
- 16
- dating apps suck
                """.strip()))

        self.assertTrue(
                potential_minor("""
So I'm not 18(don't be angry I Just wanna find friends to talk to) :/
                """.strip()))

        self.assertTrue(
                potential_minor("""
16!!!
                """.strip()))

        self.assertTrue(
                potential_minor("""
if i'm being completely honest, I'm 16 but i'm just looking for friends
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia

actually 16
                """.strip()))

        self.assertTrue(
                potential_minor("""
idk

i'm actually 16
                """.strip()))

        self.assertTrue(
                potential_minor("""
*actually 17* 6’0 joining the navy
                """.strip()))

        self.assertTrue(
                potential_minor("""
And I am between 15 and 17 years tall :0
                """.strip()))

        self.assertTrue(
                potential_minor("""
im still in high school (17)  I’m learning the guitar rn
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia

actually 16y
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia

btw im 16
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia

16
                """.strip()))

        self.assertTrue(
                potential_minor("""
not 18

lives in georgia
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia. minor.
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia. not 18
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia. 16.
                """.strip()))

        self.assertTrue(
                potential_minor("""
lives in georgia. I'm not 18.
                """.strip()))

        self.assertTrue(
                potential_minor("""
minor

lives in georgia
                """.strip()))

        self.assertTrue(
                potential_minor("""
I'm 16 and I live at home
                """.strip()))

        self.assertTrue(
                potential_minor("""
i love strawberry milk. i'm a minor. please don't talk to me if you're too old.
                """.strip()))

        self.assertTrue(
                potential_minor("""
16 yo

lives in georgia
                """.strip()))

        self.assertTrue(
                potential_minor("""
16 years

lives in georgia
                """.strip()))

        self.assertTrue(
                potential_minor("""
Tenho 17
                """.strip()))

        self.assertTrue(
                potential_minor("""
17 años
                """.strip()))

        self.assertTrue(
                potential_minor("""
I'm a minor!!
                """.strip()))

        self.assertTrue(
                potential_minor("""
I turn 18 on December
                """.strip()))

        self.assertTrue(
                potential_minor("""
i'm turning 18 on December
                """.strip()))

        self.assertTrue(
                potential_minor("""
I'm 71 backward
I'm 71 backwards
I'm 71 🔄

                """.strip()))

        self.assertTrue(
                potential_minor("""
15yrs
                """.strip()))

        self.assertTrue(
                potential_minor("""
15yo
                """.strip()))

        self.assertTrue(
                potential_minor("""
15.y.o
                """.strip()))

        self.assertTrue(
                potential_minor("""
15y/o
                """.strip()))

        self.assertTrue(
                potential_minor("""
i want to be groomed so its ok
                """.strip()))

        self.assertTrue(
                potential_minor("""
proud kiddy groomer/toucher, don't @ me
                """.strip()))

        self.assertTrue(
                potential_minor("""
i like grooming children
                """.strip()))

        self.assertTrue(
                potential_minor("""
i wanna be a victim
                """.strip()))

        self.assertTrue(
                potential_minor("""
31🔁🔁🔁
                """.strip()))

        self.assertTrue(
                potential_minor("""
31🔁
                """.strip()))

        self.assertTrue(
                potential_minor("""
18 in 14 days
                """.strip()))

        self.assertTrue(
                potential_minor("""
not 8teen
                """.strip()))

        self.assertTrue(
                potential_minor("""
18 soon
                """.strip()))

        self.assertTrue(
                potential_minor("""
71 switched
                """.strip()))

        self.assertTrue(
                potential_minor("""
(minor)
                """.strip()))

        self.assertTrue(
                potential_minor("""
17*
                """.strip()))

        self.assertTrue(
                potential_minor("""
i am an aam.
                """.strip()))

        self.assertTrue(
                potential_minor("""
61🔃
                """.strip()))


    def test_not_potential_minor(self) -> None:
        self.assertFalse(
                potential_minor("""
I'm 71
                """.strip()))

        self.assertFalse(
                potential_minor("""
1. apple
2. apricot
3. orange
                """.strip()))

        self.assertFalse(
                potential_minor("""
I've been an accountant for 16 years.
                """.strip()))

        self.assertFalse(
                potential_minor("""
I became an American citizen 16 years ago.
                """.strip()))

        self.assertFalse(
                potential_minor("""
161

not 1832
                """.strip()))

        self.assertFalse(
                potential_minor("""
 >squat: 155lbs, bench: 115lbs, deadlift: 160lbs
                """.strip()))

        self.assertFalse(
                potential_minor("""
I was bad at school when I was 16 because I had undiagnosed adhd
                """.strip()))

        self.assertFalse(
                potential_minor("""
Fun fact: I've been my family's unofficial tech support since I was 16.
                """.strip()))

        self.assertFalse(
                potential_minor("""
I’m a professional Tattoo Artist that chained careers after 17 years.
                """.strip()))

        self.assertFalse(
                potential_minor("""
10% class 20% games 15% hiking and hauling my fat ass 5% reading 50% tard 100% worship of Jesus our LORD
                """.strip()))

        self.assertFalse(
                potential_minor("""
my dog weighs 17 lbs
                """.strip()))

        self.assertFalse(
                potential_minor("""
I have travelled over 17 different countries, Japan 15 times
                """.strip()))

        self.assertFalse(
                potential_minor("""
my birthday is on the 15th
                """.strip()))

        self.assertFalse(
                potential_minor("""
I've been diagnosed autistic since I was 15
                """.strip()))

        self.assertFalse(
                potential_minor("""
Very into music, listen to atleast 15 hours a day
                """.strip()))

        self.assertFalse(
                potential_minor("""
17 seconds 16 hours 16 minutes
                """.strip()))

        self.assertFalse(
                potential_minor("""
Triceps Rope Pushdown – 3 sets x 12-15 reps
                """.strip()))

        self.assertFalse(
                potential_minor("""
LEFT ON READ 15 TIMES AND COUNTING
                """.strip()))

        self.assertFalse(
                potential_minor("""
I haven't gone outside in 15 years. Send help.
                """.strip()))

        self.assertFalse(
                potential_minor("""
So lets go hike a 15 mile public trail
                """.strip()))

        self.assertFalse(
                potential_minor("""
So lets go hike a 15 km public trail
So lets go hike a 15km public trail
                """.strip()))

        self.assertFalse(
                potential_minor("""
I've traveled 15,000 miles
                """.strip()))

        self.assertFalse(
                potential_minor("""
So lets go hike a 15 kilometer public trail
                """.strip()))

        self.assertFalse(
                potential_minor("""
15 kg
15 kilos
                """.strip()))

        self.assertFalse(
                potential_minor("""
Baby, my Civic has 15 inch rims
                """.strip()))

        self.assertFalse(
                potential_minor("""
I've worked as a mechanic for more than 15 years
                """.strip()))

        self.assertFalse(
                potential_minor("""
1 Timothy 2:15
                """.strip()))

        self.assertFalse(
                potential_minor("""
Answered a bunch of questions.. only 15 min but time is money
                """.strip()))

        self.assertFalse(
                potential_minor("""
I did it for about 15 years
                """.strip()))

        self.assertFalse(
                potential_minor("""
i spent the last 15 years browsing various imageboards
                """.strip()))

        self.assertFalse(
                potential_minor("""
I have a job making 15$ an hour
I have a job making $15 an hour
                """.strip()))

        self.assertFalse(
                potential_minor("""
I've been doing karate for 15 years.
                """.strip()))

        self.assertFalse(
                potential_minor("""
15 december
                """.strip()))

        self.assertFalse(
                potential_minor("""
I love me some 2hu though :3 especially 15.5 characters
                """.strip()))

        self.assertFalse(
                potential_minor("""
EDIT 15.05.24 aigt 1 person initiated to message me im so happy rn omaga this app isn't dead fr fr
                """.strip()))

        self.assertFalse(
                potential_minor("""
Anonymous 12/01/24(Sun)15:42:33 No.847392651
                """.strip()))

        self.assertFalse(
                potential_minor("""
This must be like the 15th time I've signed up T_T
                """.strip()))

        self.assertFalse(
                potential_minor("""
Photos of memes, things i like and me doing cosplay in the 4th one
                """.strip()))

        self.assertFalse(
                potential_minor("""
I have 10 million things to do today
                """.strip()))

        self.assertFalse(
                potential_minor("""
future twink death victim
                """.strip()))


if __name__ == '__main__':
    unittest.main()
