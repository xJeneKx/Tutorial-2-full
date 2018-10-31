/*jslint node: true */
'use strict';
const Koa = require('koa');
const app = new Koa();
const mount = require('koa-mount');
const serve = require('koa-static');
const render = require('koa-ejs');
const koaBody = require('koa-body');
const QRCode = require('qrcode');
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');

app.use(koaBody());
render(app, {
	root: __dirname + '/view',
	layout: 'template',
	viewExt: 'html',
	cache: false,
	debug: false
});
app.use(serve(__dirname + '/public'));

let assocCodeToDeviceAddress = {};
let assocCodeAndNumberToAddress = {};
let assocCodeToPaid = {};

async function index(ctx) {
	await ctx.render('index', {title: 'my blog'});
}

async function a1(ctx) {
	let assocCode = ctx.cookies.get('ac');
	if(!assocCodeToDeviceAddress[assocCode]) assocCode = null;
	let pairingCode;
	let paid = false;
	let code = 0;
	let step;
	if (!assocCode) {
		code = getCode();
		pairingCode = 'Aly99HdWoCFaxJiIHs1ldREAN/sMDhGsRHNQ2RYU9gCj@byteball.org/bb#' + code;
	} else {
		paid = await itPaid(assocCode);
	}
	let b = '';
	if (assocCode && paid) {
		step = 'final';
		b = '<br>secret body 1';
	} else if (assocCode && !paid) {
		step = 'paid';
		let address = await getAssocAddress(assocCode, 1);
		let dataURL = await QRCode.toDataURL("byteball:" + address + '?amount=100');
		b = '<br>Please pay for the article. <br>Address: ' + address + '<br>Amount: 100<br><img src="' + dataURL + '"><br>' +
			'<a href="byteball:' + address + '?amount=100">Pay</a>';
	} else {
		step = 'login';
		let dataURL = await QRCode.toDataURL("byteball:" + pairingCode);
		b = '<br>Please login using this pairing code: <a href="byteball:' + pairingCode + '">' + pairingCode + '</a><br><img src="' + dataURL + '">';
	}
	await ctx.render('article', {title: 'article 1 - my blog', b, code, step});
}

async function a2(ctx) {
	await ctx.render('article', {title: 'article 2 - my blog'});
}

async function amILogged(ctx) {
	let url = ctx.request.url;
	let match = url.match(/code=([0-9]+)/);
	if (match && assocCodeToDeviceAddress[match[1]]) {
		ctx.cookies.set('ac', match[1]);
		ctx.body = 'true';
	} else {
		ctx.body = 'false';
	}
}

async function amIPaid(ctx) {
	let code = ctx.cookies.get('ac');
	ctx.body = (code && itPaid(code)) ? 'true' : 'false';
}

function itPaid(code) {
	return !!assocCodeToPaid[code];
}

function getCode() {
	let code = Date.now();
	assocCodeToDeviceAddress[code] = null;
	return code;
}

function getAssocAddress(assocCode, number) {
	return new Promise(resolve => {
		let name = assocCode + '_' + number;
		if (assocCodeAndNumberToAddress[name]) {
			return resolve(assocCodeAndNumberToAddress[name]);
		} else {
			headlessWallet.issueNextMainAddress(address => {
				assocCodeAndNumberToAddress[name] = address;
				return resolve(address);
			});
		}
	});
}

app.use(mount('/1', a1));
app.use(mount('/2', a2));
app.use(mount('/amilogged', amILogged));
app.use(mount('/amipaid', amIPaid));
app.use(mount('/', index));
app.listen(3000);

console.log('listening on port 3000');

eventBus.once('headless_wallet_ready', () => {
	headlessWallet.setupChatEventHandlers();
	
	eventBus.on('paired', (from_address, pairing_secret) => {
		let device = require('byteballcore/device');
		assocCodeToDeviceAddress[pairing_secret] = from_address;
		device.sendMessageToDevice(from_address, 'text', 'ok');
	});
	
	eventBus.on('text', (from_address, text) => {
	
	});
	
});

eventBus.on('new_my_transactions', (arrUnits) => {
	const device = require('byteballcore/device.js');
	db.query("SELECT address, amount, asset FROM outputs WHERE unit IN (?)", [arrUnits], rows => {
		rows.forEach(row => {
			if (row.amount === 100 && row.asset === null) {
				for (let key in assocCodeAndNumberToAddress) {
					if (assocCodeAndNumberToAddress[key] === row.address) {
						let assocCode = key.split('_')[0];
						assocCodeToPaid[assocCode] = true;
						device.sendMessageToDevice(assocCodeToDeviceAddress[assocCode], 'text', 'I received your payment');
						return;
					}
				}
			}
		})
	});
});

eventBus.on('my_transactions_became_stable', (arrUnits) => {

});


process.on('unhandledRejection', up => { throw up; });
