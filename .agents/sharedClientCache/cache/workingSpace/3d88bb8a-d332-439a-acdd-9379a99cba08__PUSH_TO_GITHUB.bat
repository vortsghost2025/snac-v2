@echo off
echo.
echo SNAC v2 GitHub Repository Setup Script
echo ======================================
echo.
echo Before running this script, you must create a repository on GitHub.com
echo.
echo Please follow these steps:
echo 1. Go to https://github.com and log in to your account
echo 2. Click the "+" icon in the top-right corner and select "New repository"
echo 3. Name the repository "snac-v2" (or your preferred name)
echo 4. Select "Private" or "Public" as desired
echo 5. IMPORTANT: Do NOT initialize with README, gitignore, or license
echo 6. Click "Create repository"
echo.
set /p github_url="Enter your GitHub repository URL (e.g., https://github.com/username/snac-v2.git): "

echo.
echo Setting remote origin...
git remote set-url origin %github_url%

echo.
echo Adding all files...
git add .

echo.
echo Committing all files...
git commit -m "Initial commit: SNAC v2 complete codebase"

echo.
echo Pushing to GitHub...
git push -u origin main

echo.
echo Repository pushed successfully!
echo.
echo To deploy to your Hostinger VPS, follow these steps:
echo 1. SSH into your VPS
echo 2. Run: git clone %github_url%
echo 3. Navigate to the backend directory: cd snac-v2/backend
echo 4. Install dependencies: npm install
echo 5. Set up environment: cp .env.example .env (then edit .env with real values)
echo 6. Start the application: npm start
echo.
echo For Docker deployment:
echo 1. Make sure Docker and Docker Compose are installed
echo 2. Run: docker-compose up -d --build
echo.
pause