const allMaps = require('../../public/config/maps_competitive.json');
const getConnectionsByLobbyId = require('./getConnectionsByLobbyId');

const sendJson = (ws, data) => {
	const dataAsString = JSON.stringify(data);
	if (ws.readyState !== 1) {
		return console.error(`Trying to send ${dataAsString} to ${ws.id} with ready state ${ws.readyState}`);
	}
	ws.send(dataAsString)
};

const areMapsValid = maps => maps.every(mapId => allMaps.items.find(({ id }) => id === mapId));

const countMaps = allMaps.items.length;

const removeForeignIds = (ws, participant) => {
	if (ws.id !== participant.id) {
		return {
			...participant,
			id: null
		};
	}
	return participant;
};

const updateParticipants = (webSocketServer, lobbyId) => {
	const connections = getConnectionsByLobbyId(webSocketServer, lobbyId);
	const items = connections.map(({ id, name, voted, vetoed }, index) => ({
		id,
		name: name || `Player ${index + 1}`,
		voted,
		vetoed
	}));
	connections.forEach(ws =>
		sendJson(ws, ['participants', { items: items.map(participant => removeForeignIds(ws, participant)) }])
	);
};

const publishResult = (webSocketServer, lobbyId) => {
	const connections = getConnectionsByLobbyId(webSocketServer, lobbyId);
	const items = connections.map(({ votes, vetos }, index) => ({
		name: `Player ${index + 1}`,
		votes,
		vetos
	}));
	connections.forEach(ws => sendJson(ws, ['result', { items }]));
};

const handleMapChange = (webSocketServer, ws, validationProp, listProp, limit, data) => {
	if (data.maps.length > limit) {
		console.log(`${ws.id} ${validationProp} more than ${limit} maps: ${JSON.stringify(data)}`);
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
	updateParticipants(webSocketServer, ws.lobbyId);
};

const handleResetChoices = (webSocketServer, ws, validationProp, listProp) => {
	ws[validationProp] = false;
	ws[listProp] = [];
	updateParticipants(webSocketServer, ws.lobbyId);
};

const showResult = (webSocketServer, lobbyState, ws) => {
	if (ws.id !== lobbyState.adminId) {
		console.log(`${ws.id} tried to show result as non-admin`);
		return;
	}
	updateParticipants(webSocketServer, ws.lobbyId);
	publishResult(webSocketServer, ws.lobbyId);
};

const resetSingleConnection = ws => {
	ws.votes = [];
	ws.voted = false;
	ws.vetos = [];
	ws.vetoed = false;
	sendJson(ws, ['reset']);
};

const reset = (webSocketServer, lobbyState, ws) => {
	if (ws.id !== lobbyState.adminId) {
		console.log(`${ws.id} tried to reset as non-admin`);
		return;
	}
	getConnectionsByLobbyId(webSocketServer, lobbyState.id).forEach(resetSingleConnection);
	updateParticipants(webSocketServer, ws.lobbyId);
};

const choiceSettingsIsNotValid = (value) => {
	return (value < 0 || value > countMaps || !Number.isInteger(value));
};

const changeSettings = (webSocketServer, lobbyState, ws, data) => {
	if (ws.id !== lobbyState.adminId) {
		console.log(`${ws.id} tried to change settings as non-admin`);
		return;
	}
	const { votesPerParticipant, vetosPerParticipant } = data;

	if (choiceSettingsIsNotValid(votesPerParticipant)) {
		console.log(`${ws.id} tried to set votesPerParticipant to an invalid value: ${JSON.stringify(data)}`);
		return;
	}

	if (choiceSettingsIsNotValid(vetosPerParticipant)) {
		console.log(`${ws.id} tried to set vetosPerParticipant to an invalid value: ${JSON.stringify(data)}`);
		return;
	}

	lobbyState.votesPerParticipant = votesPerParticipant;
	lobbyState.vetosPerParticipant = vetosPerParticipant;

	updateSettingsForAll(webSocketServer, lobbyState);
	reset(webSocketServer, lobbyState, ws);
}

const getSettings = lobbyState => ({
	votesPerParticipant: lobbyState.votesPerParticipant,
	vetosPerParticipant: lobbyState.vetosPerParticipant,
	gameModes: ["competitive", "scrimmage"]
});

const updateSettings = (ws, lobbyState) => sendJson(ws, ['settings', getSettings(lobbyState)]);

const updateSettingsForAll = (webSocketServer, lobbyState) => getConnectionsByLobbyId(webSocketServer, lobbyState.id)
	.forEach(ws => sendJson(ws, ['settings', getSettings(lobbyState)]));

const changeParticipantName = (webSocketServer, ws, data) => {
	if (data.name.length > 30) {
		return console.log(`${ws.id} tried to set participant name to an invalid value`);
	}

	ws.name = data.name;
	updateParticipants(webSocketServer, ws.lobbyId);
};

const process = (webSocketServer, lobbyState, ws, msg) => {
	try {
		const [msgType, data] = JSON.parse(msg);

		switch (msgType) {
			case 'show_result':
				showResult(webSocketServer, lobbyState, ws);
				break;
			case 'voted':
				handleMapChange(webSocketServer, ws, 'voted', 'votes', lobbyState.votesPerParticipant, data);
				break;
			case 'vetoed':
				handleMapChange(webSocketServer, ws, 'vetoed', 'vetos', lobbyState.vetosPerParticipant, data);
				break;
			case 'reset_votes':
				handleResetChoices(webSocketServer, ws, 'voted', 'votes');
				break;
			case 'reset_vetos':
				handleResetChoices(webSocketServer, ws, 'vetoed', 'vetos');
				break;
			case 'reset':
				reset(webSocketServer, lobbyState, ws);
				break;
			case 'settings':
				changeSettings(webSocketServer, lobbyState, ws, data);
				break;
			case 'participant_name_changed':
				changeParticipantName(webSocketServer, ws, data);
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
};
