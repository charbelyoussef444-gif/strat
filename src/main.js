import { Net } from './network.js';
import { Lobby } from './lobby.js';
import { Game } from './game.js';

const net = new Net();
let game = null;

const lobby = new Lobby(net, () => {
  game = new Game(net);
  game.start();
});

window.__strat = { net, lobby, get game() { return game; } };
