# Full Disk Diagnostics for C: and S: Drives

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  SYSTEMATIC DEBUG SWEEP - C: and S: DRIVES" -ForegroundColor Magenta
Write-Host "  Timestamp: $(Get-Date)" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

Write-Host "`n[1] DRIVE SPACE USAGE" -ForegroundColor Cyan
Write-Host "---------------------------"
$c = Get-PSDrive C
$s = Get-PSDrive S
Write-Host "C: Used=$([math]::Round($c.Used/1GB,2))GB / Free=$([math]::Round($c.Free/1GB,2))GB / Total=$([math]::Round(($c.Used+$c.Free)/1GB,2))GB"
Write-Host "S: Used=$([math]::Round($s.Used/1GB,2))GB / Free=$([math]::Round($s.Free/1GB,2))GB / Total=$([math]::Round(($s.Used+$s.Free)/1GB,2))GB"

Write-Host "`n[2] VOLUME HEALTH STATUS" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-Volume | Where-Object { $_.DriveLetter -in @('C','S') } | ForEach-Object {
    $pct = [math]::Round(($_.SizeRemaining / $_.Size) * 100, 1)
    Write-Host "Drive $($_.DriveLetter): Label='$($_.FileSystemLabel)' FS=$($_.FileSystem)"
    Write-Host "  Size=$([math]::Round($_.Size/1GB,2))GB / Free=$([math]::Round($_.SizeRemaining/1GB,2))GB ($pct%)"
    Write-Host "  Health=$($_.HealthStatus) / DriveType=$($_.DriveType) / IsDirty=$($_.DirtyBitDetected)"
}

Write-Host "`n[3] PHYSICAL DISK INFO" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-PhysicalDisk | ForEach-Object {
    Write-Host "Device: $($_.FriendlyName)"
    Write-Host "  Type: $($_.MediaType) | Status: $($_.OperationalStatus) | Health: $($_.HealthStatus)"
    Write-Host "  Size: $([math]::Round($_.Size/1GB,2))GB | Bus: $($_.BusType) | IsSystem: $($_.IsSystem)"
}

Write-Host "`n[4] DISK PARTITION LAYOUT" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-Disk | ForEach-Object {
    Write-Host "Disk #$($_.Number): $($_.FriendlyName)"
    Write-Host "  Partition Style: $($_.PartitionStyle) | Size: $([math]::Round($_.Size/1GB,2))GB"
    Write-Host "  Operational: $($_.OperationalStatus) | Health: $($_.HealthStatus)"
    Write-Host "  Offline: $($_.IsOffline) | ReadOnly: $($_.IsReadOnly)"
}

Write-Host "`n[5] PARTITION DETAILS (C: and S:)" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -in @('C','S') } | ForEach-Object {
    Write-Host "Partition $($_.PartitionNumber) - Drive $($_.DriveLetter):"
    Write-Host "  Type: $($_.Type) | Size: $([math]::Round($_.Size/1GB,2))GB | Offset: $($_.Offset)"
}

Write-Host "`n[6] FILE SYSTEM FLAGS" -ForegroundColor Cyan
Write-Host "---------------------------"
$vC = Get-Volume -DriveLetter C
$vS = Get-Volume -DriveLetter S
Write-Host "C: DirtyBit=$($vC.DirtyBitDetected) | FileSystem=$($vC.FileSystem) | ObjStatus=$($vC.ObjectId)"
Write-Host "S: DirtyBit=$($vS.DirtyBitDetected) | FileSystem=$($vS.FileSystem) | ObjStatus=$($vS.ObjectId)"

Write-Host "`n[7] DISK PERFORMANCE METRICS" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-Disk | ForEach-Object {
    $perf = Get-Disk -UniqueId $_.FriendlyName -ErrorAction SilentlyContinue
    Write-Host "Disk $($_.Number): $($_.FriendlyName)"
}

Write-Host "`n[8] RECENT ERROR EVENTS (System Log - Last 3 Days)" -ForegroundColor Cyan
Write-Host "---------------------------"
$errs = Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-3)} -MaxEvents 50 -ErrorAction SilentlyContinue | 
    Where-Object { $_.LevelDisplayName -in @('Error','Critical','Warning') }
$diskErrs = $errs | Where-Object { $_.Message -match 'disk|storage|volume|NTFS|cluster|IO|scsi|ataport' }
if ($diskErrs) {
    $diskErrs | Select-Object -First 10 | ForEach-Object {
        Write-Host "[$($_.TimeCreated)] $($_.LevelDisplayName): $($_.Message.Substring(0, [Math]::Min(120, $_.Message.Length)))..."
    }
} else {
    Write-Host "No disk/storage related errors in last 3 days" -ForegroundColor Green
}

Write-Host "`n[9] SMART RELIABILITY DATA" -ForegroundColor Cyan
Write-Host "---------------------------"
$smart = Get-StorageReliabilityCounter -ErrorAction SilentlyContinue
if ($smart) {
    $smart | ForEach-Object {
        Write-Host "DeviceID: $($_.DeviceId)"
        Write-Host "  Temp: $($_.Temperature) | PowerOnHours: $($_.PowerOnHours)"
        Write-Host "  ReadErrorRate: $($_.ReadErrorRate) | WriteErrorRate: $($_.WriteErrorRate)"
        Write-Host "  ReallocatedSectors: $($_.ReallocatedSectorCount) | PendingSectors: $($_.PendingSectorCount)"
    }
} else {
    Write-Host "SMART data not available via PowerShell (may require admin elevation)"
}

Write-Host "`n[10] STORAGE TIER INFO" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-StorageTier -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Tier: $($_.FriendlyName) | Size: $([math]::Round($_.Size/1GB,2))GB | MediaType: $($_.MediaType)"
}

Write-Host "`n[11] VIRTUAL MEMORY / PAGEFILE" -ForegroundColor Cyan
Write-Host "---------------------------"
Get-CimInstance Win32_PageFileUsage | ForEach-Object {
    Write-Host "Pagefile: Peak=$($_.PeakUsage)MB | Current=$($_.CurrentUsage)MB | Base=$($_.AllocatedBaseSize)MB"
}

Write-Host "`n[12] LARGE FILES ON DRIVES (>1GB)" -ForegroundColor Cyan
Write-Host "---------------------------"
Write-Host "Scanning C: for large files (this may take a moment)..."
Get-ChildItem C:\ -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.Length -gt 1GB } | 
    Select-Object -First 10 | 
    ForEach-Object { Write-Host "  C: $($_.FullName) ($([math]::Round($_.Length/1GB,2))GB)" }

Write-Host "Scanning S: for large files (this may take a moment)..."
Get-ChildItem S:\ -Recurse -File -ErrorAction SilentlyContinue | 
    Where-Object { $_.Length -gt 1GB } | 
    Select-Object -First 10 | 
    ForEach-Object { Write-Host "  S: $($_.FullName) ($([math]::Round($_.Length/1GB,2))GB)" }

Write-Host "`n[13] DISK QUICK CHECK (chkdsk flags)" -ForegroundColor Cyan
Write-Host "---------------------------"
Write-Host "C: Running filesystem verification..."
$fsutilC = fsutil fsinfo volumeinfo C: 2>$null
if ($fsutilC) { $fsutilC | ForEach-Object { Write-Host "  $_" } }

Write-Host "`nS: Running filesystem verification..."
$fsutilS = fsutil fsinfo volumeinfo S: 2>$null
if ($fsutilS) { $fsutilS | ForEach-Object { Write-Host "  $_" } }

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  DIAGNOSTIC SWEEP COMPLETE" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
