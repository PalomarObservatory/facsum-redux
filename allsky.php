<?php
// Proxy for the Palomar all-sky camera (internal network only).
// Caches the image to disk so most requests return instantly,
// preventing the single-threaded PHP server from blocking on network I/O.

$cache_file = __DIR__ . '/data/allsky_cache.jpg';
$cache_ttl  = 30; // seconds

// Serve cached image immediately if fresh
if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_ttl) {
    header('Content-Type: image/jpeg');
    header('Cache-Control: no-store');
    readfile($cache_file);
    exit;
}

// Cache miss or stale — fetch from camera
$url = 'http://algol.palomar.caltech.edu/instruments/allsky/AllSkyCurrentImage.JPG';

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
$data = curl_exec($ch);
curl_close($ch);

if ($data === false || strlen($data) < 1000) {
    // Serve stale cache rather than failing, if available
    if (file_exists($cache_file)) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: no-store');
        readfile($cache_file);
        exit;
    }
    http_response_code(502);
    exit;
}

file_put_contents($cache_file, $data);

header('Content-Type: image/jpeg');
header('Cache-Control: no-store');
header('Content-Length: ' . strlen($data));
echo $data;
