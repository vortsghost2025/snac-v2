#Requires -Version 5.1
<#
.SYNOPSIS
    Kilo AI Chat PowerShell Module
    Enables direct AI conversation from PowerShell terminal
.DESCRIPTION
    Connects PowerShell to the Inter-Agent Message Bus for real-time AI chat
    Works with the Kilo extension and provides accessibility features
.EXAMPLE
    Import-Module .\KiloChat.psm1
    Connect-KiloChat
    Send-KiloMessage "Hello, can you help me with this code?"
#>

# Configuration
$script:MessageBusPath = Join-Path $PSScriptRoot ".agents" "mailboxes"
$script:AgentId = $env:DEV_AGENT_ID
$script:MyMailbox = $null
$script:ChatListener = $null
$script:TTS = $null

# Initialize TTS for accessibility
function Initialize-KiloTTS {
    try {
        Add-Type -AssemblyName System.Speech
        $script:TTS = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $script:TTS.Volume = 100
        return $true
    } catch {
        Write-Warning "TTS not available: $_"
        return $false
    }
}

# Speak message for accessibility
function Speak-KiloMessage {
    param([string]$Message)
    if ($script:TTS) {
        $truncated = if ($Message.Length -gt 200) { $Message.Substring(0, 200) + "..." } else { $Message }
        $script:TTS.SpeakAsync($truncated) | Out-Null
    }
}

<#
.SYNOPSIS
    Connect to the Kilo AI Chat system
#>
function Connect-KiloChat {
    param(
        [string]$AgentName = "dev-kimi",
        [switch]$EnableTTS = $true
    )
    
    $script:AgentId = $AgentName
    $env:DEV_AGENT_ID = $AgentName
    
    # Ensure mailbox exists
    $script:MyMailbox = Join-Path $script:MessageBusPath $AgentName
    if (!(Test-Path $script:MyMailbox)) {
        New-Item -ItemType Directory -Path $script:MyMailbox -Force | Out-Null
    }
    
    # Initialize TTS
    if ($EnableTTS) {
        Initialize-KiloTTS
        Speak-KiloMessage "Connected to Kilo AI Chat as $AgentName"
    }
    
    Write-Host "🔌 Connected to Kilo AI Chat as: " -NoNewline -ForegroundColor Green
    Write-Host $AgentName -ForegroundColor Cyan
    Write-Host "📬 Mailbox: $script:MyMailbox" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Commands:" -ForegroundColor Yellow
    Write-Host "  Send-KiloMessage <text>     - Send message to AI" -ForegroundColor White
    Write-Host "  Get-KiloInbox               - Check your messages" -ForegroundColor White
    Write-Host "  Watch-KiloChat              - Real-time chat listener" -ForegroundColor White
    Write-Host "  Disconnect-KiloChat         - Stop chat session" -ForegroundColor White
    
    return $true
}

<#
.SYNOPSIS
    Send a message to the AI
#>
function Send-KiloMessage {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Message,
        
        [string]$To = "dev-kimi",
        
        [ValidateSet("message", "request", "question", "alert")]
        [string]$Type = "message"
    )
    
    if (!$script:AgentId) {
        Write-Error "Not connected. Run Connect-KiloChat first"
        return
    }
    
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $messageId = "msg_${timestamp}_$(Get-Random -Maximum 999999)"
    
    $envelope = @{
        id = $messageId
        from = $script:AgentId
        to = $To
        type = $Type
        message = $Message
        timestamp = (Get-Date).ToString("o")
        metadata = @{
            source = "powershell"
            pid = $PID
        }
    }
    
    # Write to recipient's mailbox
    $recipientMailbox = Join-Path $script:MessageBusPath $To
    $messagePath = Join-Path $recipientMailbox "$messageId.json"
    
    try {
        # Atomic write
        $tempPath = "$messagePath.tmp"
        $envelope | ConvertTo-Json -Depth 3 | Set-Content -Path $tempPath -Encoding UTF8
        Move-Item -Path $tempPath -Destination $messagePath -Force
        
        Write-Host "✅ Message sent ($messageId)" -ForegroundColor Green
        
        # Also write to chat history
        $chatLog = Join-Path $PSScriptRoot ".agents" "CHAT_HISTORY.jsonl"
        ($envelope | ConvertTo-Json -Compress) | Add-Content -Path $chatLog
        
        return $messageId
    } catch {
        Write-Error "Failed to send message: $_"
        return $null
    }
}

<#
.SYNOPSIS
    Get messages from your inbox
#>
function Get-KiloInbox {
    param([int]$Limit = 10)
    
    if (!$script:MyMailbox -or !(Test-Path $script:MyMailbox)) {
        Write-Error "Mailbox not found. Run Connect-KiloChat first"
        return
    }
    
    $messages = Get-ChildItem -Path $script:MyMailbox -Filter "*.json" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First $Limit |
        ForEach-Object {
            Get-Content $_.FullName | ConvertFrom-Json
        }
    
    if ($messages.Count -eq 0) {
        Write-Host "📭 No messages" -ForegroundColor Gray
        return
    }
    
    Write-Host "📬 You have $($messages.Count) messages:" -ForegroundColor Cyan
    Write-Host ""
    
    foreach ($msg in $messages) {
        $time = [DateTime]$msg.timestamp
        $relative = if ($time.Date -eq (Get-Date).Date) { $time.ToString("HH:mm") } else { $time.ToString("MMM dd") }
        
        Write-Host "[$relative] " -NoNewline -ForegroundColor Gray
        Write-Host "$($msg.from): " -NoNewline -ForegroundColor Yellow
        Write-Host "$($msg.message.Substring(0, [Math]::Min(100, $msg.message.Length)))" -ForegroundColor White
        
        if ($msg.message.Length -gt 100) {
            Write-Host "  ... (use Read-KiloMessage '$($msg.id)' for full text)" -ForegroundColor DarkGray
        }
        
        # Speak incoming messages
        Speak-KiloMessage "Message from $($msg.from): $($msg.message)"
    }
    
    return $messages
}

<#
.SYNOPSIS
    Read a specific message by ID
#>
function Read-KiloMessage {
    param([Parameter(Mandatory=$true)][string]$MessageId)
    
    $messagePath = Join-Path $script:MyMailbox "$MessageId.json"
    
    if (Test-Path $messagePath) {
        $msg = Get-Content $messagePath | ConvertFrom-Json
        
        Write-Host ""
        Write-Host "From: $($msg.from)" -ForegroundColor Yellow
        Write-Host "Time: $($msg.timestamp)" -ForegroundColor Gray
        Write-Host "Type: $($msg.type)" -ForegroundColor Cyan
        Write-Host "---" -ForegroundColor Gray
        Write-Host $msg.message -ForegroundColor White
        Write-Host ""
        
        Speak-KiloMessage $msg.message
        
        return $msg
    } else {
        Write-Error "Message not found: $MessageId"
    }
}

<#
.SYNOPSIS
    Watch for new messages in real-time
#>
function Watch-KiloChat {
    param([int]$Interval = 1000)
    
    Write-Host "👀 Watching for messages... (Press Ctrl+C to stop)" -ForegroundColor Green
    Write-Host ""
    
    $lastCheck = Get-Date
    
    try {
        while ($true) {
            $newMessages = Get-ChildItem -Path $script:MyMailbox -Filter "*.json" -File |
                Where-Object { $_.LastWriteTime -gt $lastCheck } |
                Sort-Object LastWriteTime
            
            foreach ($file in $newMessages) {
                $msg = Get-Content $file.FullName | ConvertFrom-Json
                
                $time = Get-Date -Format "HH:mm:ss"
                Write-Host "[$time] 🔥 NEW from $($msg.from): " -NoNewline -ForegroundColor Green
                Write-Host "$($msg.message.Substring(0, [Math]::Min(80, $msg.message.Length)))..." -ForegroundColor White
                
                Speak-KiloMessage "New message from $($msg.from): $($msg.message)"
            }
            
            $lastCheck = Get-Date
            Start-Sleep -Milliseconds $Interval
        }
    } catch {
        Write-Host ""
        Write-Host "👋 Chat watcher stopped" -ForegroundColor Yellow
    }
}

<#
.SYNOPSIS
    Disconnect from chat
#>
function Disconnect-KiloChat {
    if ($script:TTS) {
        Speak-KiloMessage "Disconnected from Kilo chat"
        $script:TTS.Dispose()
        $script:TTS = $null
    }
    
    $script:AgentId = $null
    $script:MyMailbox = $null
    
    Write-Host "👋 Disconnected from Kilo AI Chat" -ForegroundColor Yellow
}

<#
.SYNOPSIS
    Quick chat - send message and show recent replies
#>
function Chat-Kilo {
    param(
        [Parameter(Mandatory=$true, ValueFromPipeline=$true)]
        [string]$Message,
        
        [string]$To = "dev-kimi"
    )
    
    begin {
        if (!$script:AgentId) {
            Connect-KiloChat -EnableTTS
        }
    }
    
    process {
        $msgId = Send-KiloMessage -Message $Message -To $To
        
        if ($msgId) {
            Write-Host "⏳ Waiting for response..." -ForegroundColor Gray
            Start-Sleep -Seconds 2
            Get-KiloInbox -Limit 5
        }
    }
}

# Aliases for convenience
New-Alias -Name kchat -Value Connect-KiloChat -Force
New-Alias -Name kmsg -Value Send-KiloMessage -Force
New-Alias -Name kinbox -Value Get-KiloInbox -Force
New-Alias -Name kwatch -Value Watch-KiloChat -Force
New-Alias -Name kbye -Value Disconnect-KiloChat -Force

# Export functions
Export-ModuleMember -Function @(
    'Connect-KiloChat',
    'Send-KiloMessage',
    'Get-KiloInbox',
    'Read-KiloMessage',
    'Watch-KiloChat',
    'Disconnect-KiloChat',
    'Chat-Kilo'
) -Alias @('kchat', 'kmsg', 'kinbox', 'kwatch', 'kbye')

Write-Host ""
Write-Host "🚀 Kilo Chat PowerShell Module Loaded" -ForegroundColor Cyan
Write-Host "Type 'Connect-KiloChat' to start chatting with AI" -ForegroundColor White
Write-Host ""
