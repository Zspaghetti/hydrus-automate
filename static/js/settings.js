// static/js/settings.js

// Import necessary functions/state from api.js for theme application
import { fetchClientSettings } from './api.js';

// Global variable for butler name header if it exists on settings page
// let butlerNameHeaderSettings; // Example: <h1 id="butler-name-header-settings">

/**
 * Updates the butler name in the settings page header (if such an element exists).
 * This relies on window.HYDRUS_BUTLER_SETTINGS being populated by a base HTML template.
 */
function updateButlerNameDisplayOnSettingsPage() {
    // const butlerNameHeaderElement = document.getElementById('butler-name-header-settings'); // Example ID
    if (window.HYDRUS_BUTLER_SETTINGS && window.HYDRUS_BUTLER_SETTINGS.butler_name) {
        console.log(`Settings Page: Butler name is ${window.HYDRUS_BUTLER_SETTINGS.butler_name}`);
        // if (butlerNameHeaderElement) {
        //    butlerNameHeaderElement.textContent = `${window.HYDRUS_BUTLER_SETTINGS.butler_name} - Settings`;
        // }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Settings Page: DOM fully loaded and parsed.');
    
    // --- TAB SWITCHING LOGIC ---
    const menuItems = document.querySelectorAll('.side-menu-nav .side-menu-item');
    const panels = document.querySelectorAll('.settings-panel');

    const showPanel = (panelId) => {
        // Deactivate all panels and menu items first
        panels.forEach(panel => {
            panel.classList.remove('active');
        });
        menuItems.forEach(item => {
            item.classList.remove('active');
        });

        // Activate the target panel and its corresponding menu item
        const targetPanel = document.querySelector(panelId);
        const targetMenuItem = document.querySelector(`.side-menu-nav .side-menu-item[href="${panelId}"]`);

        if (targetPanel && targetMenuItem) {
            targetPanel.classList.add('active');
            targetMenuItem.classList.add('active');
            console.log(`Switched to panel: ${panelId}`);
        } else {
            // If the target doesn't exist, show the first one as a fallback
            if (panels.length > 0) panels[0].classList.add('active');
            if (menuItems.length > 0) menuItems[0].classList.add('active');
            console.log(`Fallback: Switched to first panel.`);
        }
    };

    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent default anchor jump
            const panelId = item.getAttribute('href');
            // Update URL hash without page reload for bookmarking
            if(window.location.hash !== panelId) {
                history.pushState(null, '', panelId);
            }
            showPanel(panelId);
        });
    });

    // Check for a hash in the URL on page load and show the correct panel
    const initialPanelId = window.location.hash;
    if (initialPanelId && document.querySelector(initialPanelId)) {
        showPanel(initialPanelId);
    } else {
        // Show the first panel by default if no hash is present or hash is invalid
        if (menuItems.length > 0) {
            const firstPanelId = menuItems[0].getAttribute('href');
            history.replaceState(null, '', firstPanelId); // Set a clean hash
            showPanel(firstPanelId);
        }
    }
    // --- END: TAB SWITCHING LOGIC ---


    // Apply theme and update butler name display on load
    try {
        await fetchClientSettings(); // Fetches other client settings
        updateButlerNameDisplayOnSettingsPage(); // If butler name is displayed in settings page header
    } catch (error) {
        console.error("Settings Page: Error during initial setup (butler name):", error);
    }

    const settingsForm = document.getElementById('settings-form');
    const messagesDiv = document.getElementById('status-message'); 

    if (settingsForm) {
        settingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            console.log('Settings form submission initiated.');
            
            if (messagesDiv) {
                messagesDiv.textContent = 'Saving...';
                messagesDiv.className = 'status-message status-info';
                messagesDiv.style.display = 'block';
            }

            const formData = new FormData(settingsForm);
            
            const ruleInterval = formData.get('rule_interval_seconds');
            if (ruleInterval && parseInt(ruleInterval, 10) < 0) {
                if (messagesDiv) {
                    messagesDiv.textContent = 'Error: Rule Interval cannot be negative.';
                    messagesDiv.className = 'status-message status-error';
                }
                return;
            }
            const lastViewedThreshold = formData.get('last_viewed_threshold_seconds');
            if (lastViewedThreshold && parseInt(lastViewedThreshold, 10) < 0) {
                 if (messagesDiv) {
                    messagesDiv.textContent = 'Error: Last Viewed Threshold cannot be negative.';
                    messagesDiv.className = 'status-message status-error';
                 }
                return;
            }

            try {
                const response = await fetch('/save_settings', {
                    method: 'POST',
                    body: formData
                });

                if (response.redirected) {
                    console.log("Settings saved, browser is handling redirect.");
                    window.location.href = response.url; // Explicitly follow redirect
                } else if (!response.ok) {
                    let errorData = { message: `HTTP error! Status: ${response.status}` };
                    try {
                        const jsonData = await response.json();
                        if (jsonData && jsonData.message) errorData.message = jsonData.message;
                    } catch (e) {
                        errorData.message = response.statusText || errorData.message;
                    }
                    console.error('Failed to save settings:', errorData.message);
                    if (messagesDiv) {
                        messagesDiv.textContent = `Error: ${errorData.message}`;
                        messagesDiv.className = 'status-message status-error';
                    }
                } else {
                    console.log("Save successful, but no redirect was sent. Manually reloading.");
                    window.location.reload(); 
                }
            } catch (error) {
                console.error('Network error or other issue saving settings:', error);
                if (messagesDiv) {
                    messagesDiv.textContent = `Error: ${error.message || 'A network error occurred.'}`;
                    messagesDiv.className = 'status-message status-error';
                }
            }
        });
    } else {
        console.warn('Settings form (#settings-form) not found.');
    }

    // Logic for Manual Log Pruning Button
    const pruneButton = document.getElementById('manual-prune-button');
    if (pruneButton && messagesDiv) {
        pruneButton.addEventListener('click', () => {
            pruneButton.disabled = true;
            messagesDiv.textContent = 'Pruning logs, please wait...';
            messagesDiv.className = 'status-message status-info';
            messagesDiv.style.display = 'block';

            fetch('/logs/prune_manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
            .then(response => response.json())
            .then(data => {
                messagesDiv.textContent = data.message;
                messagesDiv.className = data.success ? 'status-message status-success' : 'status-message status-error';
            })
            .catch(error => {
                console.error('Error triggering log pruning:', error);
                messagesDiv.textContent = 'A client-side error occurred. Could not reach the server.';
                messagesDiv.className = 'status-message status-error';
            })
            .finally(() => {
                pruneButton.disabled = false;
                setTimeout(() => {
                    if (!messagesDiv.textContent.toLowerCase().includes('error')) {
                       messagesDiv.style.display = 'none';
                    }
                }, 5000);
            });
        });
    }

});