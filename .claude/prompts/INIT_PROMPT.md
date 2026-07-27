Create an award winning app based on the board game "Hypothetically" (https://shop.iv.studio/products/hypothetically-board-game-limited-edition?srsltid=AfmBOopdRzpIaGcd_gjqaLCcAoYS1bBc8jWA08sD_9W2W-AvUSX0c37S)

The basic flow of the app is the homepage should have one of the Hypothetically Board Game questions chosen at random from a pool of questions. Below it is the phrase "Got an answer?" and below that is the Google OAuth button "Sign in with Google"

After logging in, the user is shown a prompt box to answer the question.

After answering the question, the user is shown the current average answer amongst the submitted answers from everyone who answered that specific question. In this page, the user sees how far their guess was to the current winner "leaderboard style". Below this leaderboard, there is a button that says "Answer Another Question" which loops them back to the homepage with a different question and an input box to type in their answer.

I have already created a Mongo DB instance with a MONGODB_URI in the .env file as well as the GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for the Google OAuth process
