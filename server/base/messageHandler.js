const allMaps = require('../../public/config/maps_competitive.json');

const sendJson = (ws, data) => {
	const dataAsString = JSON.stringify(data);
	if (ws.readyState !== 1) {
		return console.error(`Trying to send ${dataAsString} to ${ws.id} with ready state ${ws.readyState}`);
	}
	ws.send(dataAsString)
};

const areMapsValid = maps => maps.every(mapId => allMaps.items.find(({ id }) => id === mapId));

const countMaps = allMaps.items.length;

const updateParticipants = (wss) => {
	const items = [];
	wss.clients.forEach(
		({ voted, vetoed }) => items.push({
			name: `Player ${items.length + 1}`,
			voted,
			vetoed
		})
	);
	wss.clients.forEach(ws => sendJson(ws, ['participants', { items }]));
}

const publishResult = (wss) => {
	const items = [];
	wss.clients.forEach(
		({ votes, vetos }) => items.push({
			name: items.length + 1,
			votes,
			vetos
		})
	);
	wss.clients.forEach(ws => sendJson(ws, ['result', { items }]));
}

const handleMapChange = (webSocketServer, state, ws, validationProp, listProp, limitProp, data) => {
	if (data.maps.length > state[limitProp]) {
		console.log(`${ws.id} ${validationProp} more than ${state[limitProp]} maps: ${JSON.stringify(data)}`);
		return;
	}
	if (!areMapsValid(data.maps)) {
		console.log(`${ws.id} ${validationProp} invalid maps: ${JSON.stringify(data)}`);
		return;
	}
	if (ws[validationProp]) {
		console.log(`${ws.id} tried to change ${listProp} multiple times`);
		return;
	}
	ws[listProp] = ws[listProp].length ? ws[listProp] : data.maps;
	ws[validationProp] = true;
	updateParticipants(webSocketServer.getWss());
};

const showResult = (webSocketServer, state, ws) => {
	if (ws.id !== state.adminId) {
		console.log(`${ws.id} tried to show result as non-admin`);
		return;
	}
	const wss = webSocketServer.getWss();
	updateParticipants(wss);
	publishResult(wss);
}

const reset = (webSocketServer, state, ws) => {
	if (ws.id !== state.adminId) {
		console.log(`${ws.id} tried to reset as non-admin`);
		return;
	}
	webSocketServer.getWss().clients.forEach(ws => {
		ws.votes = [];
		ws.voted = false;
		ws.vetos = [];
		ws.vetoed = false;
		sendJson(ws, ['reset']);
	});
	updateParticipants(webSocketServer.getWss());
}

const slider = (webSocketServer, state, ws, data) => {
	if (ws.id !== state.adminId) {
		console.log(`${ws.id} tried to change slider settings as non-admin`);
		return;
	}
	const votesPerParticipant = data.items[0].votesPerParticipant;
	const vetosPerParticipant = data.items[0].vetosPerParticipant

	if (sliderIsNotValid(votesPerParticipant) || sliderIsNotValid(vetosPerParticipant)) {
		console.log(`${ws.id} tried to set slider to an invalid value: ${JSON.stringify(data)}`);
		return;
	}

	state.votesPerParticipant = votesPerParticipant;
	state.vetosPerParticipant = vetosPerParticipant;

	updateSettings(webSocketServer, state);
	reset(webSocketServer, state, ws);
}

const updateSettings = (webSocketServer, state) => {
	const items = {votesPerParticipant: state.votesPerParticipant, vetosPerParticipant: state.vetosPerParticipant};
	const wss = webSocketServer.getWss();
	wss.clients.forEach(ws => sendJson(ws, ['settings', items]));
}

const sliderIsNotValid = (value) => {
	return (value < 0 || value > countMaps || !Number.isInteger(value));
}

const process = (webSocketServer, state, ws, msg) => {
	try {
		const [msgType, data] = JSON.parse(msg);

		switch (msgType) {
			case 'show_result':
				showResult(webSocketServer, state, ws);
				break;
			case 'voted':
				handleMapChange(webSocketServer, state, ws, 'voted', 'votes', 'votesPerParticipant', data);
				break;
			case 'vetoed':
				handleMapChange(webSocketServer, state, ws, 'vetoed', 'vetos', 'vetosPerParticipant', data);
				break;
			case 'reset':
				reset(webSocketServer, state, ws)
				break;
			case 'slider':
				slider(webSocketServer, state, ws, data)
				break;
			default:
				console.log(`Unkown message ${msg} from ${ws.id}`);
				break;
		}
	} catch (err) {
		console.error(`Could not parse message ${msg}: `, err);
	}
};

module.exports = {
	process,
	updateParticipants,
	sendJson,
	updateSettings
}
