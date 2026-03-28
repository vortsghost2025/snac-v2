@echo off
setlocal enabledelayedexpansion

REM Agent Chat CLI Tool
REM Enables humans to trigger agent-to-agent communication

if "%~1"=="" goto :usage
if "%~1"=="send" goto :send
if "%~1"=="inbox" goto :inbox
if "%~1"=="broadcast" goto :broadcast
if "%~1"=="count" goto :count

:usage
echo Usage:
echo   agent-chat send ^<recipient^> ^<message^>     - Send direct message
echo   agent-chat broadcast ^<message^>             - Broadcast to all agents
echo   agent-chat inbox                            - Check your inbox
echo   agent-chat count                            - Count unread messages
goto :eof

:send
if "%~2"=="" (
  echo ERROR: Missing recipient
  goto :usage
)
if "%~3"=="" (
  echo ERROR: Missing message
  goto :usage
)

REM Combine all arguments after the second into the message
set "recipient=%2"
shift
shift
set "message=%*"

echo Sending message to %recipient%...
node src/agents/agent-chat-cli.js send %recipient% "%message%"
goto :eof

:inbox
echo Checking inbox...
node src/agents/agent-chat-cli.js inbox
goto :eof

:broadcast
if "%~2"=="" (
  echo ERROR: Missing message
  goto :usage
)

REM Combine all arguments after the first into the message
shift
set "message=%*"

echo Broadcasting message...
node src/agents/agent-chat-cli.js broadcast "%message%"
goto :eof

:count
echo Counting unread messages...
node src/agents/agent-chat-cli.js count
goto :eof