/**
 * Starts a debug server
 * Arguments
 *   --port  Port to start debug server on. Defaults to 8001
 */

var http = require('http'),
    staticServer = require('node-static'),
    argv = require('minimist')(process.argv);

var PORT = argv.port || 8001;

var file = new staticServer.Server('./');

http.createServer(function(req, res) {
  file.serve(req, res);
}).listen(PORT);

console.log("Serving on localhost:" + PORT);
