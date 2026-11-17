#!/usr/bin/env bash
# ==============================================================================
# AI PharmaGuru LMS Backend Deployment Tool
# Firebase App Hosting (Alternative Deployment: CLI & Console Zip Upload)
# Reference: https://firebase.google.com/docs/app-hosting/alt-deploy#deploy-console
# ==============================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

PROJECT_ID="aipharmaguru"
BACKEND_ID="aipharmaguru"
DIST_DIR="$SCRIPT_DIR/dist-deploy"

# Colors
BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
NC='\033[0m'

print_banner() {
    echo -e "${BOLD}${CYAN}================================================================${NC}"
    echo -e "${BOLD}${CYAN}   AI PharmaGuru LMS Backend Deployment (App Hosting)           ${NC}"
    echo -e "${BOLD}${CYAN}================================================================${NC}"
    echo -e "Project ID: ${GREEN}$PROJECT_ID${NC} | Backend ID: ${GREEN}$BACKEND_ID${NC}\n"
}

check_prerequisites() {
    echo -e "${BOLD}[1/4] Verifying Configuration & Core Files...${NC}"
    
    if [ ! -f "package.json" ]; then
        echo -e "${RED}❌ Error: package.json missing in $SCRIPT_DIR${NC}"
        exit 1
    fi

    if [ ! -f "apphosting.yaml" ]; then
        echo -e "${RED}❌ Error: apphosting.yaml missing in $SCRIPT_DIR${NC}"
        exit 1
    fi

    if [ ! -f "package-lock.json" ]; then
        echo -e "${YELLOW}⚠️ package-lock.json missing. Generating via npm install...${NC}"
        npm install --package-lock-only
    fi

    if [ ! -f "firebase.json" ]; then
        echo -e "${YELLOW}Creating local firebase.json for App Hosting...${NC}"
        cat <<EOF > firebase.json
{
  "apphosting": {
    "backendId": "$BACKEND_ID",
    "rootDir": "/",
    "ignore": [
      "node_modules",
      ".git",
      "firebase-debug.log",
      "firebase-debug.*.log",
      ".env.development",
      ".env.backup",
      "dist-deploy",
      "src/config/serviceAccountKey.json"
    ]
  }
}
EOF
    fi

    echo -e "${GREEN}✔ Configuration verified.${NC}"
}

sync_secrets() {
    echo -e "\n${BOLD}${MAGENTA}--- Syncing Secrets with Cloud Secret Manager ---${NC}"
    if [ -f "update_secrets.js" ]; then
        node update_secrets.js
    else
        echo -e "${YELLOW}⚠️ update_secrets.js not found. Skipping secrets sync.${NC}"
    fi
}

package_for_console() {
    echo -e "\n${BOLD}[2/4] Packaging Source Archive for Firebase Console Upload...${NC}"
    mkdir -p "$DIST_DIR"

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    ZIP_FILENAME="backend-deploy-${TIMESTAMP}.zip"
    ZIP_PATH="$DIST_DIR/$ZIP_FILENAME"
    LATEST_ZIP="$DIST_DIR/backend-latest.zip"
    TGZ_FILENAME="backend-deploy-${TIMESTAMP}.tgz"
    TGZ_PATH="$DIST_DIR/$TGZ_FILENAME"
    LATEST_TGZ="$DIST_DIR/backend-latest.tgz"

    # Clean old artifacts if older than 7 days
    find "$DIST_DIR" -type f -name "backend-deploy-*" -mtime +7 -delete 2>/dev/null || true

    echo -e "Creating clean deployment archive (excluding node_modules, .git, local dev secrets)..."

    # Zip excluding temporary, local development secrets and large caches
    zip -r -q "$ZIP_PATH" . \
        -x "node_modules/*" \
        -x ".git/*" \
        -x "dist-deploy/*" \
        -x "*.log" \
        -x ".env" \
        -x ".env.development" \
        -x ".env.backup" \
        -x "src/config/serviceAccountKey.json" \
        -x ".eslintrc.json" \
        -x ".prettierrc" \
        -x "manual_test.sh" \
        -x "scratch_test_*" \
        -x "test_*" \
        -x "verify_*"

    cp "$ZIP_PATH" "$LATEST_ZIP"

    # Also build .tgz (alternative supported format by console)
    tar --exclude='node_modules' \
        --exclude='.git' \
        --exclude='dist-deploy' \
        --exclude='*.log' \
        --exclude='.env' \
        --exclude='.env.development' \
        --exclude='.env.backup' \
        --exclude='src/config/serviceAccountKey.json' \
        -czf "$TGZ_PATH" .
    cp "$TGZ_PATH" "$LATEST_TGZ"

    ZIP_SIZE=$(du -h "$ZIP_PATH" | cut -f1)
    TGZ_SIZE=$(du -h "$TGZ_PATH" | cut -f1)

    echo -e "${GREEN}✔ Source archives generated successfully:${NC}"
    echo -e "   • Zip Archive:  ${CYAN}$ZIP_PATH${NC} (${BOLD}$ZIP_SIZE${NC})"
    echo -e "   • Fast Symlink: ${CYAN}$LATEST_ZIP${NC}"
    echo -e "   • TGZ Archive:  ${CYAN}$TGZ_PATH${NC} (${BOLD}$TGZ_SIZE${NC})"

    echo -e "\n${BOLD}${GREEN}================================================================${NC}"
    echo -e "${BOLD}${GREEN}   Firebase Console Zip Upload Instructions                     ${NC}"
    echo -e "${BOLD}${GREEN}   (https://firebase.google.com/docs/app-hosting/alt-deploy#deploy-console)${NC}"
    echo -e "${BOLD}${GREEN}================================================================${NC}"
    echo -e "1. Open Firebase App Hosting Console:"
    echo -e "   ${CYAN}https://console.firebase.google.com/project/${PROJECT_ID}/apphosting${NC}"
    echo -e "2. In the App Hosting dashboard:"
    echo -e "   - If backend exists: click ${BOLD}'Create rollout'${NC} -> select ${BOLD}'Upload a zip'${NC}"
    echo -e "   - If creating new: click ${BOLD}'Get started' / 'Create backend'${NC} -> select ${BOLD}'Upload a zip'${NC}"
    echo -e "3. Drag & drop the archive file:"
    echo -e "   ${BOLD}${YELLOW}$LATEST_ZIP${NC}"
    echo -e "4. Set Settings:"
    echo -e "   - App root directory: ${BOLD}/${NC}"
    echo -e "5. Click ${BOLD}'Finish and Deploy'${NC} (or 'Deploy')\n"
}

deploy_via_cli() {
    echo -e "\n${BOLD}[3/4] Deploying via Firebase CLI (App Hosting)...${NC}"
    
    FIREBASE_CMD="npx -y firebase-tools@latest"
    if command -v firebase &> /dev/null; then
        FIREBASE_CMD="firebase"
    fi

    # Check login status
    echo -e "Checking Firebase CLI authentication..."
    if ! $FIREBASE_CMD projects:list &>/dev/null; then
        echo -e "${RED}❌ Firebase CLI is not authenticated.${NC}"
        echo -e "Please log in using one of the following commands:"
        echo -e "   ${CYAN}$FIREBASE_CMD login${NC} (browser popup)"
        echo -e "   ${CYAN}$FIREBASE_CMD login --no-localhost${NC} (headless/remote)\n"
        echo -e "${YELLOW}Tip: You can use the Console Zip Upload instead with: ./deploy.sh --zip${NC}"
        return 1
    fi

    echo -e "${GREEN}✔ Authenticated. Initiating deployment to backend '$BACKEND_ID'...${NC}"
    
    $FIREBASE_CMD deploy --only "apphosting:$BACKEND_ID" --project "$PROJECT_ID"
    
    echo -e "\n${GREEN}✔ CLI Deployment initiated successfully!${NC}"
}

show_help() {
    print_banner
    echo -e "Usage: ./deploy.sh [OPTIONS]\n"
    echo -e "Options:"
    echo -e "  -z, --zip       Generate .zip and .tgz archives for Firebase Console upload"
    echo -e "  -c, --cli       Deploy directly using Firebase CLI (firebase deploy)"
    echo -e "  -s, --secrets   Sync production secrets to Google Cloud Secret Manager"
    echo -e "  -a, --all       Run secrets sync, package archive, and attempt CLI deploy"
    echo -e "  -h, --help      Display this help menu\n"
    echo -e "Interactive Mode:"
    echo -e "  Run without flags to open the interactive selection menu.\n"
}

# Parse flags
ACTION=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -z|--zip)
            ACTION="zip"
            shift
            ;;
        -c|--cli)
            ACTION="cli"
            shift
            ;;
        -s|--secrets)
            ACTION="secrets"
            shift
            ;;
        -a|--all)
            ACTION="all"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown argument: $1${NC}"
            show_help
            exit 1
            ;;
    esac
done

print_banner
check_prerequisites

# If no action passed, prompt interactively if tty is available, else default to zip packaging
if [ -z "$ACTION" ]; then
    if [ -t 0 ]; then
        echo -e "${BOLD}Select deployment method:${NC}"
        echo -e "  ${CYAN}[1]${NC} Package .zip / .tgz for Firebase Console Upload (Recommended for fast deploy)"
        echo -e "  ${CYAN}[2]${NC} Deploy directly via Firebase CLI (firebase deploy --only apphosting)"
        echo -e "  ${CYAN}[3]${NC} Sync Secrets to Cloud Secret Manager (update_secrets.js)"
        echo -e "  ${CYAN}[4]${NC} All-in-One (Sync Secrets + Package Zip + CLI Deploy)"
        echo -e "  ${CYAN}[q]${NC} Quit"
        echo ""
        read -p "Enter choice [1-4, q]: " choice
        case $choice in
            1) ACTION="zip" ;;
            2) ACTION="cli" ;;
            3) ACTION="secrets" ;;
            4) ACTION="all" ;;
            q|Q) exit 0 ;;
            *) echo -e "${RED}Invalid choice.${NC}"; exit 1 ;;
        esac
    else
        echo -e "${YELLOW}Non-interactive environment detected. Defaulting to packaging source archive...${NC}"
        ACTION="zip"
    fi
fi

case $ACTION in
    zip)
        package_for_console
        ;;
    cli)
        deploy_via_cli
        ;;
    secrets)
        sync_secrets
        ;;
    all)
        sync_secrets
        package_for_console
        deploy_via_cli || {
            echo -e "\n${YELLOW}CLI deploy paused. You can still use the generated package for Console Upload above.${NC}"
        }
        ;;
esac
