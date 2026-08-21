# tests/test_aboutdiff.py

import unittest
from service.api.person.aboutdiff import diff_addition_with_context

class TestDiffAdditionWithContext(unittest.TestCase):

    def test_no_change_returns_none(self) -> None:
        """When old==new, there’s no insertion, so we get None."""
        self.assertIsNone(diff_addition_with_context("abc", "abc"))

    def test_simple_insertion_returns_full_new(self) -> None:
        """A small insertion in a single-sentence string should return the full new text."""
        old = "Hello world"
        new = "Hello brave new world"
        self.assertEqual(
            diff_addition_with_context(old, new),
            new
        )

    def test_truncate_oversized_insertion(self) -> None:
        """If the insertion alone exceeds window_size, it should be truncated to window_size."""
        old = "I like cats and dogs"
        new = "I don't like cucumbers and carrots but I like cats and dogs"
        snippet = diff_addition_with_context(old, new, window_size=10)
        self.assertEqual(snippet, "I don't li…")

    def test_full_context_if_window_large(self) -> None:
        """When window_size is larger than the full text, you get the entire new string."""
        old = "Foo. Bar baz."
        new = "Foo. Bar wonderful baz."
        snippet = diff_addition_with_context(old, new, window_size=100)
        self.assertEqual(snippet, new)

    def test_boundary_start_for_sentence(self) -> None:
        """
        Ensure that for a small window, the snippet still includes the entire insertion
        and starts at the closest sentence/line boundary (or at the very insertion start
        if no boundary can cover it).
        """
        old = "Boo! Alice loves cats."
        new = "Boo! Alice loves cats and dogs."
        snippet = diff_addition_with_context(old, new, window_size=20)
        self.assertEqual(snippet, "Alice loves cats an…")

    def test_exact_fit_window(self) -> None:
        """
        When the insertion exactly matches window_size, we should get back exactly that insertion.
        """
        old = "x"
        new = "y"
        snippet = diff_addition_with_context(old, new, window_size=1)
        self.assertEqual(snippet, "y")

    def test_zero_length_strings(self) -> None:
        snippet = diff_addition_with_context("", "", window_size=10)
        self.assertEqual(snippet, None)

        snippet = diff_addition_with_context("", "a", window_size=10)
        self.assertEqual(snippet, 'a')

        snippet = diff_addition_with_context("a", "", window_size=10)
        self.assertEqual(snippet, None)

    def test_addition_is_a_boundary(self) -> None:
        snippet = diff_addition_with_context("", ".", window_size=10)
        self.assertEqual(snippet, '.')

        snippet = diff_addition_with_context("", "...", window_size=10)
        self.assertEqual(snippet, '...')

    def test_nearest_suboptimal_boundary_is_to_the_right(self) -> None:
        snippet = diff_addition_with_context(
            "I hope that you like this brand new ",
            "I hope that you like this brand new addition.",
            window_size=10
        )
        self.assertEqual(snippet, 'I hope tha…')

    def test_insertion_at_start(self) -> None:
        snippet = diff_addition_with_context(
            "world",
            "Hello world",
            window_size=5
        )
        self.assertEqual(snippet, 'Hello…')

    def test_whitespace_only_insertion(self) -> None:
        snippet = diff_addition_with_context(
            "Hello",
            "Hello   ",
            window_size=5
        )
        self.assertEqual(snippet, None)

    def test_last_insertion(self) -> None:
        snippet = diff_addition_with_context(
            "A. B. C.",
            "A. X. B. Y. C.",
            window_size=6
        )
        self.assertEqual(snippet, 'B. Y…')

    def test_emoji(self) -> None:
        snippet = diff_addition_with_context(
            "There's no denying it. I love pizza",
            "There's no denying it. I love 🍕 and sushi",
            window_size=12,
        )
        self.assertEqual(snippet, 'I love 🍕 an…')

    def test_newlines(self) -> None:
        snippet = diff_addition_with_context(
            "There's no denying it. I love pizza\n"
            "a\n"
            "b\n"
            "c\n"
            ,

            "There's no denying it. I love pizza\n"
            "a\n"
            "b\n"
            "c\n"
            "d\n"
            "e\n"
            "f\n"
            ,

            window_size=8,
            max_newlines=3,
        )
        self.assertEqual(snippet, 'b\nc\nd…')


if __name__ == "__main__":
    unittest.main()
