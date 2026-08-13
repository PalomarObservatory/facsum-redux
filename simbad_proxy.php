<?php
ob_start();
register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && ($err['type'] & (E_ERROR | E_CORE_ERROR | E_COMPILE_ERROR | E_RECOVERABLE_ERROR))) {
        ob_end_clean();
        http_response_code(500);
        header('Content-Type: application/json');
        echo json_encode(array('friendly' => 'Server error', 'error' => 'PHP error: ' . $err['message']));
    } else {
        ob_end_flush();
    }
});

header('Content-Type: application/json');

$name = isset($_GET['name']) ? trim($_GET['name']) : '';
if ($name === '') {
    http_response_code(400);
    echo json_encode(array('friendly' => 'No name provided', 'error' => 'No name provided'));
    exit;
}

// CDS Sesame: name goes after '?' as a query string, NOT as a path component.
// -ox = XML output, extended (includes proper motions); p = query all resolvers in parallel.
$url = 'https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oxp?' . urlencode($name);

if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT,        15);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_USERAGENT,      'FACSUM/1.0 (Palomar Observatory)');
    $xml    = curl_exec($ch);
    $errno  = curl_errno($ch);
    $errmsg = curl_error($ch);
    curl_close($ch);
    if ($xml === false || $errno) {
        http_response_code(502);
        echo json_encode(array('friendly' => 'Could not reach SIMBAD', 'error' => "curl $errno: $errmsg"));
        exit;
    }
} else {
    $ctx = stream_context_create(array(
        'http' => array('timeout' => 15, 'ignore_errors' => true),
        'ssl'  => array('verify_peer' => false, 'verify_peer_name' => false),
    ));
    $xml = @file_get_contents($url, false, $ctx);
    if ($xml === false) {
        http_response_code(502);
        echo json_encode(array('friendly' => 'Could not reach SIMBAD', 'error' => 'file_get_contents failed'));
        exit;
    }
}

function sesame_get($xml, $tag) {
    if (preg_match('/<' . $tag . '>\s*([-+]?[0-9][0-9.eE+\-]*)\s*<\/' . $tag . '>/', $xml, $m)) {
        return $m[1];
    }
    return null;
}

$jradeg = sesame_get($xml, 'jradeg');
$jdedeg = sesame_get($xml, 'jdedeg');

if ($jradeg === null || $jdedeg === null) {
    http_response_code(404);
    $snippet = substr(preg_replace('/\s+/', ' ', $xml), 0, 400);
    echo json_encode(array('friendly' => 'Target not found', 'error' => 'No coordinates in Sesame response', 'raw' => $snippet));
    exit;
}

$pmra  = sesame_get($xml, 'pmRA');
$pmdec = sesame_get($xml, 'pmDE');

echo json_encode(array(
    'ra_deg'  => (float) $jradeg,
    'dec_deg' => (float) $jdedeg,
    'pmra'    => $pmra  !== null ? (float) $pmra  : null,
    'pmdec'   => $pmdec !== null ? (float) $pmdec : null,
));
