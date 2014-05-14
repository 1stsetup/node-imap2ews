var net = require('net');

var imapProtocol = require('./imapProtocol');

var server = net.createServer(function(socket) { //'connection' listener
	console.log('server connected');
	socket.imapHandler = new imapProtocol(undefined, socket);

	socket.imapHandler.on('imapOk', function(tag, command, args) {
		socket.write(tag+" OK "+command+"\r\n");
	});

	socket.imapHandler.on('imapBad', function(tag, string) {
		socket.write(tag+" BAD "+string+"\r\n");
	});

	socket.imapHandler.on('imapNo', function(string) {
		socket.write('* NO '+string+"\r\n");
	});

	socket.on('end', function() {
		console.log('server disconnected');
		socket.imapHandler.close();
	});
	socket.write('* OK IMAP4rev1 server ready\r\n');
	socket.pipe(socket.imapHandler);
});

server.listen(8124, function() { //'listening' listener
	console.log('server bound');
});
