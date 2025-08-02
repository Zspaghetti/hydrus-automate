from flask import Blueprint

# Define the main blueprint for all views.
# The template_folder is specified to point up one level to the main 'templates' dir.
views_bp = Blueprint('views', __name__, template_folder='../templates')

# Import the modules at the end to register their routes with the blueprint.
# This avoids circular dependency issues.
from . import core
from . import rules
from . import sets
from . import logs