// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  // public/assets holds the static pages copied from duolicious.app, whose
  // scripts aren't app code; service-worker.js and the rest of public/ are
  // still linted.
  ignorePatterns: ['/dist/*', '/public/assets/*'],
  rules: {
    "@typescript-eslint/no-empty-object-type": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-redeclare": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_$",
        "varsIgnorePattern": "^_$",
        "caughtErrorsIgnorePattern": "^_$"
      }
    ],
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          {
            "group": ["react-native", "react-native-gesture-handler"],
            "importNamePattern": "^(Pressable|Touchable\\w*)$",
            "message": "Use Pressable from components/pressable. React Native's tap targets lose taps near the top of the screen to iOS's scroll-to-top."
          }
        ]
      }
    ],
    "react-hooks/exhaustive-deps": "off",
    "react/display-name": "off",
  }
};
