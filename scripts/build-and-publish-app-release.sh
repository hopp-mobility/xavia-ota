#!/bin/bash

# Check if the correct number of arguments are provided
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "Usage: $0 <runtimeVersion> <xavia-ota-url> <upload-key> [updateGroup]"
  echo ""
  echo "  updateGroup is optional; omit to publish to the default group."
  exit 1
fi

# Get the current commit hash and message
commitHash=$(git rev-parse HEAD)
commitMessage=$(git log -1 --pretty=%B)

# Assign arguments to variables
runtimeVersion=$1
serverHost=$2
uploadKey=$3
updateGroup=$4

# Generate a timestamp for the output folder
timestamp=$(date -u +%Y%m%d%H%M%S)
outputFolder="./ota-builds/$timestamp"

# Ask the user to confirm the hash, commit message, runtime version, and output folder
echo "Output Folder: $outputFolder"
echo "Runtime Version: $runtimeVersion"
echo "Commit Hash: $commitHash"
echo "Commit Message: $commitMessage"
echo "Update Group: ${updateGroup:-(default)}"

read -p "Do you want to proceed with these values? (y/n): " confirm

if [ "$confirm" != "y" ]; then
  echo "Operation cancelled by the user."
  exit 1
fi

rm -rf $outputFolder
mkdir -p $outputFolder

# Run expo export with the specified output folder
npx expo export --output-dir $outputFolder

# Resolve the expo config (works for app.json, app.config.js, or app.config.ts)
# --type public emits the manifest-shape config, matching what's served to clients.
npx expo config --type public --json > $outputFolder/expoconfig.json


# Zip the output folder (operate inside it, then return to project root)
projectRoot=$(pwd)
cd "$outputFolder"
zip -q -r "${timestamp}.zip" .


# Upload the zip file to the server
uploadArgs=(-F "file=@${timestamp}.zip" -F "runtimeVersion=$runtimeVersion" -F "commitHash=$commitHash" -F "commitMessage=$commitMessage" -F "uploadKey=$uploadKey")
if [ -n "$updateGroup" ]; then
  uploadArgs+=(-F "updateGroup=$updateGroup")
fi
curl -X POST "$serverHost/api/upload" "${uploadArgs[@]}"

echo ""

echo "Uploaded to $serverHost/api/upload"
cd "$projectRoot"

# Remove the output folder and zip file
rm -rf $outputFolder

echo "Removed $outputFolder"
echo "Done"
