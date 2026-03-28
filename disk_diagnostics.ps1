# Disk Diagnostics Script for C: and S: Drives

Write-Host "=== DRIVE SPACE ANALYSIS ===" -ForegroundColor Cyan
Get-PSDrive -Name C,S | ForEach-Object {
    $total = $_.Used + $_.Free
    Write-Host "Drive $($_.Name): Used=$( [math]::Round($_.Used/1GB,2) )GB / Free=$( [math]::Round($_.Free/1GB,2) )GB / Total=$( [math]::Round($total/1GB,2) )GB"
}

Write-Host "`n=== VOLUME INFORMATION ===" -ForegroundColor Cyan
Get-Volume | Where-Object { $_.DriveLetter -in @('C','S') } | ForEach-Object {
    Write-Host "Drive $($_.DriveLetter): Label='$($_.FileSystemLabel)' FS=$($_.FileSystem) Size=$( [math]::Round($_.Size/1GB,2) )GB Free=$( [math]::Round($_.SizeRemaining/1GB,2) )GB Health=$($_.HealthStatus)"
}

Write-Host "`n=== PHYSICAL DISK STATUS ===" -ForegroundColor Cyan
Get-PhysicalDisk | ForEach-Object {
    Write-Host "Disk: $($_.FriendlyName) Type=$($_.MediaType) Status=$($_.OperationalStatus) Health=$($_.HealthStatus) Size=$( [math]::Round($_.Size/1GB,2) )GB"
}

Write-Host "`n=== DISK PARTITION INFO ===" -ForegroundColor Cyan
Get-Disk | ForEach-Object {
    Write-Host "Disk #$($_.Number): $($_.FriendlyName) Partition=$($_.PartitionStyle) Size=$( [math]::Round($_.Size/1GB,2) )GB Status=$($_.OperationalStatus) Health=$($_.HealthStatus) Offline=$($_.IsOffline)"
}

Write-Host "`n=== FILE SYSTEM CHECK (Quick) ===" -ForegroundColor Cyan
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-Volume -DriveLetter C
$ss = Get-Volume -DriveLetter S

if ($cs) {
    Write-Host "C: DriveType=$($cs.DriveType) FileSystem=$($cs.FileSystem) DirtyBit=$($cs.DirtyBitDetected)"
}
if ($ss) {
    Write-Host "S: DriveType=$($ss.DriveType) FileSystem=$($ss.FileSystem) DirtyBit=$($ss.DirtyBitDetected)"
}

Write-Host "`n=== RECENT DISK EVENTS (Last 24h) ===" -ForegroundColor Cyan
Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 20 -ErrorAction SilentlyContinue | Where-Object { $_.LevelDisplayName -in @('Error','Critical','Warning') -and $_.Message -match 'disk|storage|volume|NTFS' } | ForEach-Object {
    Write-Host "[$($_.TimeCreated)] $($_.LevelDisplayName): $($_.Message.Substring(0, [Math]::Min(100, $_.Message.Length)))..."
}

Write-Host "`n=== SMART STATUS CHECK ===" -ForegroundColor Cyan
Get-StorageReliabilityCounter -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Device=$($_.DeviceId) Temp=$($_.Temperature) PowerOnHours=$($_.PowerOnHours) ReadErrors=$($_.ReadErrorRate) WriteErrors=$($_.WriteErrorRate)"
}

Write-Host "`n=== PARTITION ALIGNMENT CHECK ===" -ForegroundColor Cyan
Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter -in @('C','S') } | ForEach-Object {
    Write-Host "Drive=$($_.DriveLetter) Type=$($_.Type) Offset=$($_.Offset) Size=$( [math]::Round($_.Size/1GB,2) )GB"
}
