<h1 align="center" style="border-bottom: none">
        <img src="logo.svg" width="100" />
        <br>
        Tomatic
</h1>

<div align="center">

<a href="https://tomatic.app">https://tomatic.app</a>

</div>

<h1>Tomatic</h1>
Openrouter based AI Chat Interface.

## Goals
- Frontend-only (statically hosted)
- All AI models via Openrouter 
- UI Very close to the LLM API interface. No hidden system prompts.
- Space efficient UI, high information density

## Getting Started

You can set up your development environment in two ways. We recommend using Devbox for a fully reproducible setup, but a standard Node.js environment works perfectly well.

### Recommended Setup (with Devbox)

This approach uses [Devbox](https://www.jetpack.io/devbox) to create a consistent development environment. It automatically provides the correct versions of Node.js and other system-level dependencies like browser drivers for tests.

**Prerequisites:**
- [Devbox](https://www.jetpack.io/devbox)
- (Optional) [direnv](https://direnv.net/) for automatic shell activation.

**Steps:**

1.  **Enter the development shell.**
    If you have `direnv` installed, `cd` into the project directory and run `direnv allow`.
    Otherwise, activate it manually:
    ```bash
    devbox shell
    ```

2.  **Install project dependencies.**
    Inside the shell, Devbox provides `npm`.
    ```bash
    npm install
    ```

3.  **Run the development server.**
    ```bash
    npm run dev
    ```
    The app will be running at <http://localhost:5173>.

### Alternative Setup (with npm)

This is a standard setup for a Vite React project. You will need to manage your own Node.js installation.

**Prerequisites:**
- [Node.js](httpss://nodejs.org/) (version 24 is recommended, see `devbox.json`)

**Steps:**

1.  **Install project dependencies.**
    ```bash
    npm install
    ```

2.  **Install Playwright browsers.**
    Our end-to-end tests use Playwright, which requires separate browser binaries.
    ```bash
    npx playwright install
    ```

3.  **Run the development server.**
    ```bash
    npm run dev
    ```
    The app will be running at <http://localhost:5173>.

