var util = require('util');
var Transform = require('stream').Transform;
util.inherits(imapProtocol, Transform);

const IMAP_STATE_NOT_AUTHENTICATED = 1;
const IMAP_STATE_AUTHENTICATED = 2;
const IMAP_STATE_SELECTED = 4;
const IMAP_STATE_LOGOUT = 8;

function stateToString(aState) {
	switch (aState) {
		case IMAP_STATE_NOT_AUTHENTICATED : return "not authenticated";
		case IMAP_STATE_AUTHENTICATED : return "authenticated";
		case IMAP_STATE_SELECTED : return "selected";
		case IMAP_STATE_LOGOUT : return "logout";
	}

	return "Unknown state:"+aState;
}

var IMAP_COMMANDS = {
	"CAPABILITY" : {
		allowedStates : IMAP_STATE_NOT_AUTHENTICATED + IMAP_STATE_AUTHENTICATED + IMAP_STATE_SELECTED + IMAP_STATE_LOGOUT,
		argumentsAllowed: 0,
		responseFunc: function(imap, socket, tag) {
			socket.write("* CAPABILITY "+imap.capabilities+"\r\n");
			socket.write(tag+" OK CAPABILITY completed\r\n");
		}
	}
}

function imapProtocol(options, socket) {
	if (!(this instanceof imapProtocol))
		return new imapProtocol(options, socket);

	Transform.call(this, options);
	this._receivingString = true;
	this._receivingOctets = false;
	this._string = '';
	this._octets = [];
	this._crSeen = false;
	this._lfSeen = false;
	this._tags = {};
	this._state = IMAP_STATE_NOT_AUTHENTICATED;

	this._socket = socket;

	this._capabilities = "IMAP4rev1 STARTTLS AUTH=PLAIN LOGINDISABLED";
	var self = this;
	Object.defineProperty(this, "capabilities", {
		get: function() { return self._capabilities; }
	});
}

imapProtocol.prototype.emitOK = function(tag, command, args) {
	this.emit('imapOk', tag, command, args);
}

imapProtocol.prototype.emitBAD = function(tag, string) {
	this.emit('imapBad', tag, string);
}

imapProtocol.prototype.emitNO = function(string) {
	this.emit('imapNo', string);
}

imapProtocol.prototype._processString = function(string, state, cb) {
	// Split string
	var stringParts = string.split(" ");

	if (stringParts.length < 2) {
		this.emitBAD('*', "WTF!!!");
		if (cb) cb();
		return;
	}

	var tag = stringParts[0];

	// See if we know this tag already;
	var tagSeen = (this._tags[tag] !== undefined);

	if (tagSeen) {
		this.emitBAD(tag, "Tag '"+tag+"' already seen before.");
		if (cb) cb();
		return;
	}

	this._tags[tag] = true;

	var command = stringParts[1].toUpperCase();
	if (!IMAP_COMMANDS[command]) {
		this.emitBAD(tag, "Unknown command '"+stringParts[1]+"'");
		if (cb) cb();
		return;
	}

	if (!(IMAP_COMMANDS[command].allowedStates & state)) {
		this.emitBAD(tag, "Command '"+command+"' not allowed in this state '"+stateToString(state)+"'.");
		if (cb) cb();
		return;
	}

	var agrumentCount = stringParts.length - 2;
	if (agrumentCount > IMAP_COMMANDS[command].argumentsAllowed) {
		this.emitBAD(tag, "To many arguments specified for command '"+command+"'. Only '"+IMAP_COMMANDS[command].argumentsAllowed+"' arguments allowed.");
		if (cb) cb();
		return;
	}

	stringParts.splice(0, 2);
	if (IMAP_COMMANDS[command]["responseFunc"]) {
		IMAP_COMMANDS[command].responseFunc(this, this._socket, tag);
	}
	else {
		this.emitOK(tag, command, stringParts);
	}
	if (cb) cb();

}

imapProtocol.prototype.close = function() {
}

imapProtocol.prototype._transform = function(chunk, encoding, done) {
	for (var i = 0; i < chunk.length; i++) {

		if (this._receivingString) {
			if (chunk[i] === 10) {
				if ((this._crSeen) && (!this._lfSeen)) {
					this._lfSeen = true;
					var self = this;
					this._processString(this._string, this._state, function(){
						self._lfSeen = false;
						self._crSeen = false;
						self._string = '';
					});
				}
				else {
					this.emitBAD('*', 'Received LF (0x0A) byte which I did not expect.');
					return;
				}
			}
			else if (chunk[i] === 13) {
				if (this._crSeen) {
					this.emitBAD('*', 'Received CR (0x0D) byte and previous byte was also a CR. Not expected.');
					return;
				}
				else {
					this._crSeen = true;
				}
			}
			else if (this._crSeen) {
				this.emitBAD('*', 'Expected a LF (0x0A) byte after a CR byte but received another byte.');
				return;
			}
			else {
				this._string = this._string + String.fromCharCode(chunk[i]);
			}
		}
		else {
			this._receivingCommand = true;
			this._octets.push(chunk[i]);
		}
	}

	done();
};

module.exports = imapProtocol;
