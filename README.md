Spend less time organizing and more time enjoying your collection. Hydrus Automate is your personal media butler, using an intuitive web interface to create "set it and forget it" rules for your library.

Want to automatically send files with a particular **tag** to a specific **domain**? Need to change the **rating** on all files that have a certain combination of tags? Set up a rule once, and let hydrus automate handle the tedious work for you on a recurring schedule of your choosing.

## Getting Started

Follow these steps to get your own media butler up and running.

### Prerequisites

Before you begin, ensure you have the following installed and running:

1.  **Hydrus Network:** The application you want to automate. It must be running for this tool to work.
    *   [Download Hydrus Network here](https://github.com/hydrusnetwork/hydrus)
2.  **Python 3.8 or newer:**
    *   [Download Python here](https://www.python.org/downloads/)
    *   During installation, it is highly recommended to check the box that says **"Add Python to PATH"**.

### Installation & Usage

Installation is designed to be as simple as possible.

**1. Get the Application Files**


*   **: Download from Releases (Recommended)**
    1.  Go to the [**Releases Page**](https://github.com/Zspaghetti/hydrus-automate/releases) and download the `Source code (zip)` file.
    2.  Extract the contents of the ZIP file on your computer (e.g., `C:\Tools\hydrus-automate`).

You may also clone the repository with git.

**2. Run the Startup Script**

Navigate into the `hydrus-automate` folder that you just extracted or cloned. The startup scripts will automatically create a virtual environment, install all required Python libraries, and start the web server.

*   **On Windows:**
    Double-click `start_windows.bat`.

*   **On macOS or Linux:**
    Open your terminal in the `hydrus-automate` folder and run:
    ```bash
    bash start_macOS.sh
    ```

Once it's running, you will see output in the terminal indicating the server has started, like:
`INFO: Starting Waitress server on http://127.0.0.1:5556/`

### First-Time Setup

Once the server is running, you need to connect it to your Hydrus client.

**1. Open the Web Interface**

Open your web browser and go to: **[http://127.0.0.1:5556](http://127.0.0.1:5556)**

**2. Configure Settings**

*   Navigate to the **Settings** page using the sidebar.
*   You will need to provide your **Hydrus API URL** and **Hydrus API Access Key**.

**3. Getting Your Hydrus API Access Key**

You need to grant Hydrus Automate permission to access your client.

1.  In the Hydrus client, go to the `services` menu and select `review services`.
2.  Select the `client api` service and click `add manually`
3.  Grant it the following permissions by checking their boxes:
    *   Edit File Ratings
    *   Edit File Tags
    *   Import and Delete Files
    *   Search for and Fetch Files
4.  Click `ok` and copy the key.
5.  Back to the Hydrus Automate settings page, Paste it into the **Hydrus API Key** field. The default Hydrus API URL is (`http://127.0.0.1:45869`).
6.  Click **Save Settings**.
7.  Go back to the main page of Hydrus Automate and click retry connection.

The application should now connect to Hydrus and show an "ONLINE" status in the sidebar. You are ready to start creating rules.
