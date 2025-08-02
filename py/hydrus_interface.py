import requests
import json
import sys # For sys.stdout.encoding
import logging

# Configure logging
logger = logging.getLogger(__name__)

# --- Hydrus API Interaction Helper ---
hydrus_api_session = requests.Session() # Global session for this module

def call_hydrus_api(api_address, api_key, endpoint, method='GET', params=None, json_data=None, timeout=60):
    """
    Helper to make API calls to the Hydrus client, using a persistent session.
    Requires api_address and api_key to be passed in, making it more testable and explicit.
    """
    global hydrus_api_session

    if not api_address:
        logger.error("Hydrus API address is not configured for call_hydrus_api.")
        # This function is a low-level helper, so it returns a structured error.
        # The caller (e.g., in rule_processing.py) should handle this by not proceeding.
        return {"success": False, "message": "Hydrus API address is not configured."}, 400 # Or a more specific internal code

    # Ensure scheme is present
    if not api_address.lower().startswith('http://') and not api_address.lower().startswith('https://'):
        api_address = f'http://{api_address}'

    url = f"{api_address.rstrip('/')}{endpoint}" # Ensure no double slashes if endpoint starts with /
    headers = {
        'Hydrus-Client-API-Access-Key': api_key if api_key else ""
    }
    if json_data is not None:
        headers['Content-Type'] = 'application/json'

    try:
        response = hydrus_api_session.request(
            method,
            url,
            headers=headers,
            params=params if method == 'GET' else None,
            json=json_data if method in ['POST', 'PUT', 'PATCH'] else None, # Ensure json only for relevant methods
            timeout=timeout
        )
        response.raise_for_status() # Raises HTTPError for bad responses (4xx or 5xx)

        # Check content type before trying to parse JSON
        content_type = response.headers.get('Content-Type', '').lower()
        if response.content and 'application/json' in content_type:
            try:
                data = response.json()
                return {"success": True, "data": data}, response.status_code
            except json.JSONDecodeError as jde:
                logger.warning(f"API call to {endpoint} successful (status {response.status_code}), but response is not valid JSON. Error: {jde}")
                logger.debug(f"Response text: {response.text[:500]}") # Log part of the invalid JSON
                return {"success": False, "message": f"Request successful, but response was not valid JSON for endpoint {endpoint}.", "raw_response": response.text}, 500
        elif response.status_code >= 200 and response.status_code < 300: # Successful, but not JSON
            # E.g., 204 No Content, or text/plain success message
            return {"success": True, "message": f"Request successful (status {response.status_code}), but no JSON content or non-JSON content received ({content_type}). Response text: {response.text[:200]}"}, response.status_code
        else: # Should be caught by raise_for_status, but as a fallback
            logger.warning(f"Request to {endpoint} returned status {response.status_code} with non-JSON content ({content_type}). Raw: {response.text[:200]}")
            return {"success": False, "message": f"Request to {endpoint} returned status {response.status_code} with non-JSON content. Raw: {response.text[:200]}"}, response.status_code

    except requests.exceptions.ConnectionError as e:
        # Safe encoding for console output
        error_message_str = f"Could not connect to Hydrus client at {api_address}. Is it running? Error: {str(e)}"
        console_error_message = error_message_str.encode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace').decode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace')
        logger.error(f"ConnectionError calling Hydrus API endpoint {endpoint}: {console_error_message}")
        return {"success": False, "message": error_message_str}, 503 # Service Unavailable
    except requests.exceptions.Timeout as e:
        error_message_str = f"Request to Hydrus client timed out for endpoint {endpoint}. Error: {str(e)}"
        console_error_message = error_message_str.encode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace').decode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace')
        logger.error(f"Timeout calling Hydrus API endpoint {endpoint}: {console_error_message}")
        return {"success": False, "message": error_message_str}, 504 # Gateway Timeout
    except requests.exceptions.RequestException as e: # Catches HTTPError from raise_for_status too
        error_message_str = str(e)
        status_code = 500 # Default status code for RequestException
        response_text_safe = "N/A"

        if e.response is not None:
            status_code = e.response.status_code
            try:
                # Try to decode response text safely
                response_text_safe = e.response.text.encode('utf-8', 'replace').decode('utf-8', 'replace')
                if 'application/json' in e.response.headers.get('Content-Type', '').lower():
                    error_details = e.response.json()
                    if 'message' in error_details: error_message_str = f"{status_code}: {error_details['message']}"
                    elif 'error' in error_details: error_message_str = f"{status_code}: {error_details['error']}"
                    else: error_message_str = f"{status_code}: Unexpected error JSON format from API. Raw: {response_text_safe[:200]}"
                else: # Non-JSON error response
                    error_message_str = f"{status_code}: {response_text_safe.strip()[:500]}"
            except json.JSONDecodeError:
                error_message_str = f"{status_code}: Failed to parse error response JSON - {response_text_safe.strip()[:200]}"
            except Exception as proc_err: # Catch other errors during error processing
                error_message_str = f"{status_code}: Error processing error response ({proc_err}) - {response_text_safe.strip()[:200]}"
        else: # No response object (e.g., DNS failure)
            error_message_str = f"Hydrus API request failed for {endpoint} (no response object): {str(e)}"
            status_code = 503 # Service Unavailable might be appropriate

        console_error_message = error_message_str.encode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace').decode(sys.stdout.encoding if sys.stdout.encoding else 'utf-8', 'replace')
        logger.error(f"Error calling Hydrus API endpoint {endpoint}: {console_error_message}")
        return {"success": False, "message": f"Hydrus API Error: {error_message_str}"}, status_code