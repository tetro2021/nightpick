# NightPick

NightPick is a collaborative suggestion and random combination generator for planning your night out.

## Features

- Add suggestions across categories like Activity, Food, and Drink
- Save suggestion history in browser `localStorage`
- Generate random combinations of suggestions
- Toggle whether repeats are allowed during generation
- Responsive UI with category tabs and suggestion cards
- Node/Express backend with SQLite for user authentication, pools, and shared suggestions

## Project structure

- `server.js` - Express server with SQLite database and REST API
- `package.json` - Node dependency and start scripts
- `public/` - Static client assets served by the backend
- `public/index.html` - App shell for the NightPick frontend
- `public/app.js` - Frontend application logic
- `public/style.css` - UI styling
- `nightpick.db` - SQLite database file (created on first run)

## Prerequisites

- Node.js installed (Node 18+ recommended)
- npm available in your shell

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Open `http://localhost:3737` in your browser.

You can also set a custom port before starting the server:

```bash
PORT=4000 npm start
```

## Usage

1. Open the app in your browser
2. Enter your display name in the top bar
3. Use the `Suggest` page to add suggestions for Activity, Food, and Drink
4. Switch to the `Generate` page to create random combination sets
5. Choose whether repeats are allowed and how many combinations to generate

## Notes

- Suggestions are persisted locally in the browser via `localStorage` for the frontend experience
- The backend supports user registration, login, shared pools, and published invite-based suggestions
- The app currently uses port `3737` by default

## Dependencies

- `express`
- `better-sqlite3`
- `jsonwebtoken`
- `bcryptjs`

## License

This project does not include a license file. Add one if you want to share or distribute the code.
