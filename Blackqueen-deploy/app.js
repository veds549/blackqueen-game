const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const suits = [
  { id: "D", name: "Diamonds", symbol: "♦", color: "red" },
  { id: "C", name: "Clubs", symbol: "♣", color: "black" },
  { id: "H", name: "Hearts", symbol: "♥", color: "red" },
  { id: "S", name: "Spades", symbol: "♠", color: "black" },
];
const rankStrength = Object.fromEntries(ranks.map((rank, index) => [rank, index]));
const pointMap = { "5": 5, "10": 10, A: 15 };
const removableRanks = ["2", "3", "4", "6", "7"];
const teamOptions = {
  6: ["3 vs 3"],
  7: ["3 vs 4"],
  8: ["3 vs 5", "4 vs 4"],
};
const query = new URLSearchParams(location.search);
const multiplayer = {
  tableId: query.get("table"),
  role: query.get("role") || "local",
  playerId: query.has("player") ? Number(query.get("player")) : null,
  version: 0,
  applying: false,
  pollTimer: null,
  chatTimer: null,
  messages: [],
  lastMessageId: 0,
  unread: 0,
  chatOpen: false,
};
let installPrompt = null;

const state = {
  stage: "setup",
  round: 1,
  playerCount: 6,
  players: [],
  dealer: 0,
  deck: [],
  undealtDeck: [],
  removal: {},
  partialKeep: { rank: null, suits: [] },
  cardsPerPlayer: 14,
  teamFormat: "3 vs 3",
  partnerMode: "firstTwo",
  bidTurn: 1,
  passed: new Set(),
  highestBid: null,
  bidHistory: [],
  bidder: 1,
  bidAmount: 155,
  trump: "S",
  partnerCards: [],
  partnerClaims: [],
  currentPlayer: 1,
  trickLeader: 1,
  trick: [],
  trickNumber: 1,
  captured: {},
  scored: false,
  bidViewPlayer: 0,
};

const $ = (id) => document.getElementById(id);

async function init() {
  if (renderSharedHand()) return;
  registerInstallableApp();
  seedPlayers(6);
  seedRemoval();
  bindEvents();
  populateTeamFormat();
  populatePlayerNames();
  populateCardsPerPlayer();
  populateRankRemoval();
  populateCardSelectors();
  render();
  if (multiplayer.tableId) {
    await fetchTable(true);
    await fetchMessages(true);
    startTablePolling();
  }
}

function seedPlayers(count) {
  state.playerCount = count;
  state.players = Array.from({ length: count }, (_, index) => ({
    id: index,
    name: state.players[index]?.name || `Player ${index + 1}`,
    hand: [],
    score: state.players[index]?.score || 0,
    roundPoints: 0,
    teamRole: "defense",
    partnerMultiplier: 0,
  }));
  if (state.dealer >= count) state.dealer = 0;
}

function seedRemoval() {
  state.removal = Object.fromEntries(ranks.map((rank) => [rank, 0]));
  state.removal["2"] = 2;
  state.removal["3"] = 2;
  state.removal["4"] = 1;
  state.partialKeep = { rank: null, suits: [] };
}

function bindEvents() {
  $("installAppBtn").addEventListener("click", installApp);
  $("openRulesBtn").addEventListener("click", () => $("rulebookDialog").showModal());
  $("closeRulesBtn").addEventListener("click", () => $("rulebookDialog").close());
  $("rulebookDialog").addEventListener("click", (event) => {
    if (event.target === $("rulebookDialog")) $("rulebookDialog").close();
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (!multiplayer.tableId) setStage(tab.dataset.stage);
    });
  });
  $("playerCount").addEventListener("change", (event) => {
    seedPlayers(Number(event.target.value));
    populateTeamFormat();
    populatePlayerNames();
    populateCardsPerPlayer();
    autoRemovalForTarget(state.cardsPerPlayer);
    populateRankRemoval();
    resetRound(false);
    render();
    publishTable();
  });
  $("teamFormat").addEventListener("change", (event) => {
    state.teamFormat = event.target.value;
    render();
    publishTable();
  });
  $("partnerMode").addEventListener("change", (event) => {
    state.partnerMode = event.target.value;
    publishTable();
  });
  $("cardsPerPlayer").addEventListener("change", (event) => {
    autoRemovalForTarget(Number(event.target.value));
    populateRankRemoval();
    render();
    publishTable();
  });
  $("resetBtn").addEventListener("click", () => {
    resetGame();
    render();
    publishTable();
  });
  $("createTableBtn").addEventListener("click", createHostTable);
  $("startHandBtn").addEventListener("click", startHand);
  $("dealerSelect").addEventListener("change", (event) => {
    state.dealer = Number(event.target.value);
    resetRound(false);
    render();
    publishTable();
  });
  $("dealBtn").addEventListener("click", dealCards);
  $("passBidBtn").addEventListener("click", passBid);
  $("raiseBidBtn").addEventListener("click", raiseBid);
  $("setBidderBtn").addEventListener("click", lockBidder);
  $("bidHandPlayer").addEventListener("change", (event) => {
    state.bidViewPlayer = Number(event.target.value);
    render();
  });
  $("bidderSelect").addEventListener("change", (event) => {
    state.bidder = Number(event.target.value);
    render();
  });
  $("bidAmount").addEventListener("change", (event) => {
    state.bidAmount = Math.max(155, Number(event.target.value) || 155);
    render();
  });
  $("trumpSuit").addEventListener("change", (event) => {
    state.trump = event.target.value;
    render();
  });
  $("confirmCallBtn").addEventListener("click", confirmCall);
  $("scoreRoundBtn").addEventListener("click", scoreRound);
  $("nextHandBtn").addEventListener("click", nextHand);
  $("chatLauncher").addEventListener("click", () => toggleChat(true));
  $("chatCloseBtn").addEventListener("click", () => toggleChat(false));
  $("chatForm").addEventListener("submit", sendChatMessage);
}

function registerInstallableApp() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    $("installAppBtn").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("installAppBtn").hidden = true;
  });
}

async function installApp() {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  $("installAppBtn").hidden = true;
}

function populateTeamFormat() {
  const options = teamOptions[state.playerCount];
  $("teamFormat").innerHTML = options.map((option) => `<option>${option}</option>`).join("");
  state.teamFormat = options.includes(state.teamFormat) ? state.teamFormat : options[0];
  $("teamFormat").value = state.teamFormat;
}

function populatePlayerNames() {
  $("namesList").innerHTML = state.players
    .map(
      (player) => `
      <label class="field">
        <span>Seat ${player.id + 1}</span>
        <input value="${escapeHtml(player.name)}" data-player-name="${player.id}" />
      </label>
    `,
    )
    .join("");
  document.querySelectorAll("[data-player-name]").forEach((input) => {
    input.addEventListener("input", (event) => {
      state.players[Number(input.dataset.playerName)].name = event.target.value || `Player ${Number(input.dataset.playerName) + 1}`;
      render();
      publishTable();
    });
  });
}

function populateCardsPerPlayer() {
  const select = $("cardsPerPlayer");
  const options = [];
  for (let each = Math.floor(104 / state.playerCount); each >= 8; each -= 1) {
    const removed = 104 - each * state.playerCount;
    if (removed >= 0 && removed <= removableRanks.length * 8) options.push(each);
  }
  select.innerHTML = options.map((option) => `<option value="${option}">${option} each (${option * state.playerCount} total)</option>`).join("");
  state.cardsPerPlayer = options.includes(state.cardsPerPlayer) ? state.cardsPerPlayer : options[0];
  select.value = state.cardsPerPlayer;
}

function populateRankRemoval() {
  $("rankRemoval").innerHTML = removableRanks
    .map((rank) => {
      const removedSets = state.removal[rank] || 0;
      return `
        <div class="rank-card">
          <strong>${rank}</strong>
          <div class="stepper">
            <button data-remove-rank="${rank}" data-dir="-1" aria-label="Keep more ${rank} cards">−</button>
            <span>${removedSets}/2</span>
            <button data-remove-rank="${rank}" data-dir="1" aria-label="Remove more ${rank} cards">+</button>
          </div>
        </div>
      `;
    })
    .join("");
  document.querySelectorAll("[data-remove-rank]").forEach((button) => {
    button.addEventListener("click", () => {
      const rank = button.dataset.removeRank;
      state.removal[rank] = clamp((state.removal[rank] || 0) + Number(button.dataset.dir), 0, 2);
      if (state.partialKeep.rank === rank && state.removal[rank] === 0) {
        state.partialKeep = { rank: null, suits: [] };
      }
      render();
      populateRankRemoval();
      publishTable();
    });
  });
}

function populateCardSelectors() {
  const options = ranks
    .filter((rank) => rank !== "2" && rank !== "3")
    .flatMap((rank) => suits.map((suit) => cardKey({ rank, suit: suit.id })))
    .map((key) => `<option value="${key}">${cardLabelFromKey(key)}</option>`)
    .join("");
  $("partnerCardA").innerHTML = options;
  $("partnerCardB").innerHTML = options;
  $("partnerCardA").value = "A-S";
  $("partnerCardB").value = "A-D";
}

function setStage(stage) {
  state.stage = stage;
  document.querySelectorAll(".stage").forEach((node) => node.classList.remove("is-active"));
  $(`${stage}Stage`).classList.add("is-active");
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.stage === stage));
  render();
}

function resetGame() {
  const scores = state.players.map((player) => player.score);
  seedPlayers(state.playerCount);
  state.players.forEach((player, index) => {
    player.score = scores[index] || 0;
  });
  state.round = 1;
  state.dealer = 0;
  seedRemoval();
  resetRound(true);
  populateCardsPerPlayer();
  populateRankRemoval();
  setStage("setup");
}

function resetRound(clearDeck) {
  state.players.forEach((player) => {
    player.hand = [];
    player.roundPoints = 0;
    player.teamRole = "defense";
    player.partnerMultiplier = 0;
  });
  if (clearDeck) {
    state.deck = [];
    state.undealtDeck = [];
  }
  state.passed = new Set();
  state.highestBid = null;
  state.bidHistory = [];
  state.bidTurn = nextSeat(state.dealer);
  state.bidder = state.bidTurn;
  state.bidAmount = 155;
  state.partnerClaims = [];
  state.partnerCards = [];
  state.currentPlayer = state.bidder;
  state.trickLeader = state.bidder;
  state.trick = [];
  state.trickNumber = 1;
  state.captured = {};
  state.scored = false;
}

function autoRemovalForTarget(cardsEach) {
  state.cardsPerPlayer = cardsEach;
  const targetRemoved = 104 - cardsEach * state.playerCount;
  const next = Object.fromEntries(ranks.map((rank) => [rank, 0]));
  let removed = 0;
  let partialRank = null;
  for (const rank of removableRanks) {
    while (removed < targetRemoved && next[rank] < 2) {
      next[rank] += 1;
      removed += 4;
      partialRank = rank;
    }
  }
  state.removal = next;
  const restoreCount = Math.max(0, removed - targetRemoved);
  state.partialKeep = {
    rank: restoreCount ? partialRank : null,
    suits: suits.slice(0, restoreCount).map((suit) => suit.id),
  };
}

function startHand() {
  const inPlay = cardsInPlay();
  if (inPlay % state.playerCount !== 0) {
    setStatus(`${inPlay} cards cannot be dealt equally to ${state.playerCount} players. Adjust cards per player or trimming.`);
    return;
  }
  resetRound(true);
  state.cardsPerPlayer = inPlay / state.playerCount;
  state.deck = shuffle(buildDeck());
  state.undealtDeck = [...state.deck];
  populateDealSelectors();
  setStage("deal");
  setStatus(`Hand started with ${inPlay} cards. Dealer may choose the dealing pattern before dealing.`);
  publishTable();
}

function populateDealSelectors() {
  const playerOptions = state.players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("");
  $("dealerSelect").innerHTML = playerOptions;
  $("dealerSelect").value = state.dealer;
  $("bidderSelect").innerHTML = playerOptions;
  $("bidderSelect").value = state.bidder;
  $("bidHandPlayer").innerHTML = playerOptions;
  $("bidHandPlayer").value = state.bidViewPlayer;
}

function dealCards() {
  if (!state.undealtDeck.length) state.undealtDeck = [...state.deck];
  state.players.forEach((player) => {
    player.hand = [];
  });
  let seat = nextSeat(state.dealer);
  while (state.undealtDeck.length) {
    state.players[seat].hand.push(state.undealtDeck.shift());
    seat = nextSeat(seat);
  }
  state.players.forEach((player) => sortHand(player.hand));
  state.bidTurn = nextSeat(state.dealer);
  state.bidder = state.bidTurn;
  state.bidViewPlayer = state.bidTurn;
  state.currentPlayer = state.bidder;
  $("bidderSelect").value = state.bidder;
  $("bidHandPlayer").value = state.bidViewPlayer;
  setStage("bid");
  setStatus(`Cards dealt ${$("dealPattern").value.trim() || "1"} at a time. Bidding starts from ${state.players[state.bidTurn].name}.`);
  publishTable();
}

function passBid() {
  state.passed.add(state.bidTurn);
  state.bidHistory.push(`${state.players[state.bidTurn].name} passed`);
  advanceBidTurn();
  publishTable();
}

function raiseBid() {
  const nextBid = state.highestBid ? state.highestBid.amount + 5 : 155;
  state.highestBid = { player: state.bidTurn, amount: nextBid };
  state.bidder = state.bidTurn;
  state.bidAmount = nextBid;
  $("bidAmount").value = nextBid;
  state.bidHistory.push(`${state.players[state.bidTurn].name} bid ${nextBid}`);
  advanceBidTurn();
  publishTable();
}

function advanceBidTurn() {
  const active = state.players.filter((player) => !state.passed.has(player.id));
  if (active.length <= 1 && state.highestBid) {
    lockBidder();
    return;
  }
  do {
    state.bidTurn = nextSeat(state.bidTurn);
  } while (state.passed.has(state.bidTurn));
  render();
}

function lockBidder() {
  if (!state.highestBid) {
    state.highestBid = { player: state.bidTurn, amount: 155 };
  }
  state.bidder = state.highestBid.player;
  state.bidAmount = state.highestBid.amount;
  $("bidderSelect").value = state.bidder;
  $("bidAmount").value = state.bidAmount;
  setStage("call");
  setStatus(`${state.players[state.bidder].name} is bidder at ${state.bidAmount}. Choose cut colour and partner cards.`);
  publishTable();
}

function confirmCall() {
  const first = $("partnerCardA").value;
  const second = $("partnerCardB").value;
  state.partnerCards = [first, second];
  state.trump = $("trumpSuit").value;
  state.bidder = Number($("bidderSelect").value);
  state.bidAmount = Number($("bidAmount").value) || 155;
  state.players.forEach((player) => {
    player.teamRole = player.id === state.bidder ? "bidder" : "defense";
    player.partnerMultiplier = player.id === state.bidder ? 1 : 0;
    player.roundPoints = 0;
  });
  state.captured = Object.fromEntries(state.players.map((player) => [player.id, []]));
  state.partnerClaims = [];
  state.currentPlayer = state.bidder;
  state.trickLeader = state.bidder;
  setStage("play");
  setStatus(`${state.players[state.bidder].name} leads. Cut colour is ${suitName(state.trump)}.`);
  publishTable();
}

function playCard(playerId, cardId) {
  if (playerId !== state.currentPlayer) return;
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) return;
  const card = player.hand[index];
  if (!isLegalPlay(player, card)) {
    setStatus(`${player.name} must follow ${suitName(state.trick[0].card.suit)} if possible.`);
    return;
  }
  player.hand.splice(index, 1);
  state.trick.push({ playerId, card });
  revealPartner(playerId, card);
  if (state.trick.length === state.playerCount) {
    finishTrick();
  } else {
    state.currentPlayer = nextSeat(state.currentPlayer);
  }
  render();
  publishTable();
}

function isLegalPlay(player, card) {
  if (!state.trick.length) return true;
  const leadSuit = state.trick[0].card.suit;
  return card.suit === leadSuit || !player.hand.some((handCard) => handCard.suit === leadSuit);
}

function revealPartner(playerId, card) {
  const key = cardKey(card);
  if (!state.partnerCards.includes(key)) return;
  const matchingClaims = state.partnerClaims.filter((claim) => {
    if (state.partnerMode === "oneEach") return claim.key === key;
    return true;
  });
  if (matchingClaims.length >= (state.partnerMode === "oneEach" ? 1 : 2)) return;
  state.partnerClaims.push({ playerId, key });
  const player = state.players[playerId];
  player.teamRole = player.id === state.bidder ? "bidder" : "partner";
  player.partnerMultiplier += 1;
  setStatus(`${player.name} revealed ${cardLabel(card)} and joined the bidding team.`);
}

function finishTrick() {
  const winningPlay = getTrickWinner();
  const winner = state.players[winningPlay.playerId];
  state.captured[winner.id].push(...state.trick.map((play) => play.card));
  const trickPoints = state.trick.reduce((sum, play) => sum + cardPoints(play.card), 0);
  winner.roundPoints += trickPoints;
  state.trick = [];
  state.trickNumber += 1;
  state.trickLeader = winner.id;
  state.currentPlayer = winner.id;
  setStatus(`${winner.name} won the trick and captured ${trickPoints} points.`);
  if (state.players.every((player) => player.hand.length === 0)) {
    setStage("score");
    setStatus("The hand is complete. Score the round when ready.");
  }
}

function getTrickWinner() {
  const trumpPlays = state.trick.filter((play) => play.card.suit === state.trump);
  const contenders = trumpPlays.length ? trumpPlays : state.trick.filter((play) => play.card.suit === state.trick[0].card.suit);
  return contenders.reduce((best, play) => (rankStrength[play.card.rank] > rankStrength[best.card.rank] ? play : best), contenders[0]);
}

function scoreRound() {
  const biddingIds = biddingTeamIds();
  const biddingPoints = teamCapturedPoints(biddingIds);
  const madeBid = biddingPoints >= state.bidAmount;
  const defenseAward = madeBid ? 0 : Math.round(state.bidAmount / 2);
  state.players.forEach((player) => {
    if (biddingIds.includes(player.id)) {
      const multiplier = Math.max(1, player.partnerMultiplier);
      player.score = roundedScore(player.score + (madeBid ? state.bidAmount : -state.bidAmount) * multiplier);
    } else {
      player.score = roundedScore(player.score + defenseAward);
    }
  });
  state.scored = true;
  render();
  setStatus(madeBid ? "Bidding team made the call." : "Non-bidders broke the call.");
  publishTable();
}

function nextHand() {
  const collected = state.players.flatMap((player) => [...player.hand]).concat(Object.values(state.captured).flat());
  state.round += 1;
  state.dealer = nextSeat(state.dealer);
  resetRound(false);
  state.deck = lightShuffle(collected.length ? collected : buildDeck());
  state.undealtDeck = [...state.deck];
  populateDealSelectors();
  setStage("deal");
  setStatus("Next hand is ready with a light shuffle.");
  publishTable();
}

function buildDeck() {
  const deck = [];
  let id = 1;
  ranks.forEach((rank) => {
    const copies = 2 - (state.removal[rank] || 0);
    for (let copy = 1; copy <= copies; copy += 1) {
      suits.forEach((suit) => {
        deck.push({ id: `${rank}-${suit.id}-${copy}-${id++}`, rank, suit: suit.id, copy });
      });
    }
  });
  if (state.partialKeep.rank) {
    state.partialKeep.suits.forEach((suitId) => {
      deck.push({
        id: `${state.partialKeep.rank}-${suitId}-restored-${id++}`,
        rank: state.partialKeep.rank,
        suit: suitId,
        copy: "restored",
      });
    });
  }
  return deck;
}

function shuffle(cards) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function lightShuffle(cards) {
  const copy = [...cards];
  const swaps = Math.max(8, Math.floor(copy.length * 0.18));
  for (let index = 0; index < swaps; index += 1) {
    const a = Math.floor(Math.random() * copy.length);
    const b = Math.floor(Math.random() * copy.length);
    [copy[a], copy[b]] = [copy[b], copy[a]];
  }
  return copy;
}

function sortHand(hand) {
  hand.sort((a, b) => suits.findIndex((suit) => suit.id === a.suit) - suits.findIndex((suit) => suit.id === b.suit) || rankStrength[a.rank] - rankStrength[b.rank]);
}

function moveCard(playerId, cardId, targetCardId) {
  const hand = state.players[playerId]?.hand;
  if (!hand || cardId === targetCardId) return;
  const from = hand.findIndex((card) => card.id === cardId);
  const to = hand.findIndex((card) => card.id === targetCardId);
  if (from < 0 || to < 0) return;
  const [card] = hand.splice(from, 1);
  hand.splice(to, 0, card);
  render();
  publishTable();
}

function render() {
  $("roundLabel").textContent = `Round ${state.round}`;
  $("dealerLabel").textContent = `Dealer: ${state.players[state.dealer]?.name || "Player 1"}`;
  $("deckLabel").textContent = `${cardsInPlay()} cards`;
  $("trimSummary").textContent = `${cardsInPlay()} cards in play, ${cardsInPlay() / state.playerCount} each if equal`;
  $("trimHint").textContent = removalSummary();
  renderSuitKeepOptions();
  $("teamFormat").value = state.teamFormat;
  $("partnerMode").value = state.partnerMode;
  renderDealOverview();
  renderBidding();
  renderBidHandViewer();
  renderCall();
  renderPlay();
  renderScoreboard();
  renderMultiplayer();
  renderChat();
  applyRolePermissions();
}

function renderDealOverview() {
  $("dealOverview").innerHTML = state.players
    .map((player) => `<div class="overview-row"><strong>${escapeHtml(player.name)}</strong><span>${player.hand.length} cards</span></div>`)
    .join("");
}

function renderBidding() {
  if ($("bidHandPlayer").options.length !== state.players.length) populateDealSelectors();
  $("bidHandPlayer").value = state.bidViewPlayer;
  $("bidTurnLabel").textContent = `Turn: ${state.players[state.bidTurn]?.name || ""}`;
  $("highestBidLabel").textContent = state.highestBid
    ? `Highest: ${state.players[state.highestBid.player].name} at ${state.highestBid.amount}`
    : "Minimum bid: 155";
  $("bidHistory").innerHTML = state.bidHistory.length
    ? state.bidHistory.map((item) => `<div class="history-row">${escapeHtml(item)}</div>`).join("")
    : `<div class="history-row">No bids yet.</div>`;
}

function renderBidHandViewer() {
  const viewedId = multiplayer.role === "player" ? multiplayer.playerId : state.bidViewPlayer;
  const player = state.players[viewedId] || state.players[0];
  $("playerHandLink").href = player?.hand.length ? sharedHandUrl(player) : "#";
  $("bidHandView").innerHTML = player?.hand.length
    ? player.hand.map((card) => draggableCardHtml(player.id, card, false)).join("")
    : `<div class="empty-hand">No cards dealt.</div>`;
  bindCardSorting();
}

function renderCall() {
  const trump = suitName(state.trump);
  const bidder = state.players[state.bidder];
  $("callSummary").innerHTML = state.partnerCards.length
    ? `<div class="overview-row"><strong>${escapeHtml(bidder.name)}</strong><span>${state.bidAmount}</span></div>
       <div class="overview-row"><span>Cut colour</span><strong>${trump}</strong></div>
       <div class="overview-row"><span>Partners</span><strong>${state.partnerCards.map(cardLabelFromKey).join(", ")}</strong></div>`
    : "No call yet.";
  $("callHandCount").textContent = `${bidder?.hand.length || 0} cards`;
  $("callHandView").innerHTML = bidder?.hand.length
    ? bidder.hand.map((card) => draggableCardHtml(bidder.id, card, false)).join("")
    : `<div class="empty-hand">No cards dealt.</div>`;
  bindCardSorting();
}

function renderPlay() {
  $("trickLabel").textContent = `Trick ${Math.min(state.trickNumber, state.cardsPerPlayer)}`;
  $("playCallDetails").innerHTML = state.partnerCards.length
    ? `<span>Cut: ${suitName(state.trump)}</span><span>Partners: ${state.partnerCards.map(cardLabelFromKey).join(", ")}</span>`
    : `<span>Cut: not called</span><span>Partners: not called</span>`;
  $("trickArea").innerHTML = state.trick.length
    ? state.trick.map((play) => `<div class="played-card"><span>${escapeHtml(state.players[play.playerId].name)}</span>${cardHtml(play.card)}</div>`).join("")
    : `<div class="played-card">Waiting for ${escapeHtml(state.players[state.currentPlayer]?.name || "")}</div>`;
  const biddingIds = biddingTeamIds();
  $("biddingPoints").textContent = `Bidding team: ${teamCapturedPoints(biddingIds)}`;
  $("defensePoints").textContent = `Non-bidders: ${teamCapturedPoints(state.players.map((p) => p.id).filter((id) => !biddingIds.includes(id)))}`;
  const visiblePlayers = multiplayer.role === "player" ? state.players.filter((player) => player.id === multiplayer.playerId) : state.players;
  $("handsPanel").innerHTML = visiblePlayers
    .map((player) => {
      const active = player.id === state.currentPlayer;
      const tag = teamTag(player);
      return `
        <section class="player-hand ${active ? "is-active" : ""}">
          <div class="hand-head">
            <strong>${escapeHtml(player.name)}</strong>
            <span class="team-tag">${tag}</span>
          </div>
          <div class="cards">
            ${player.hand.map((card) => draggableCardHtml(player.id, card, active && isLegalPlay(player, card))).join("")}
          </div>
        </section>
      `;
    })
    .join("");
  document.querySelectorAll("[data-play-card]").forEach((button) => {
    button.addEventListener("click", () => playCard(Number(button.dataset.player), button.dataset.playCard));
  });
  bindCardSorting();
}

function renderScoreboard() {
  const biddingIds = biddingTeamIds();
  const biddingPoints = teamCapturedPoints(biddingIds);
  const madeBid = biddingPoints >= state.bidAmount;
  $("roundResult").innerHTML = state.players.some((player) => player.hand.length)
    ? "Finish the hand to score."
    : `<strong>${madeBid ? "Bid made" : "Bid broken"}</strong><span>Bidding team captured ${biddingPoints} of 300 points against a ${state.bidAmount} call.</span>`;
  $("scoreboard").innerHTML = state.players
    .map((player) => `<div class="score-row"><strong>${escapeHtml(player.name)}</strong><span>${roundedScore(player.score)}</span></div>`)
    .join("");
  $("scoreRoundBtn").disabled = state.players.some((player) => player.hand.length) || state.scored;
}

function teamTag(player) {
  if (player.id === state.bidder) return `Bidder ×${Math.max(1, player.partnerMultiplier)}`;
  if (player.teamRole === "partner") return `Partner ×${Math.max(1, player.partnerMultiplier)}`;
  return "Non-bidder";
}

function biddingTeamIds() {
  return state.players.filter((player) => player.id === state.bidder || player.teamRole === "partner").map((player) => player.id);
}

function teamCapturedPoints(ids) {
  return ids.reduce((sum, id) => sum + (state.captured[id] || []).reduce((cardSum, card) => cardSum + cardPoints(card), 0), 0);
}

function draggableCardHtml(playerId, card, canPlay) {
  return `
    <span class="hand-card-shell" draggable="true" data-sort-card="${card.id}" data-sort-player="${playerId}">
      <button class="card-button" data-play-card="${card.id}" data-player="${playerId}" ${canPlay ? "" : "disabled"}>
        ${cardHtml(card)}
      </button>
    </span>
  `;
}

function bindCardSorting() {
  document.querySelectorAll("[data-sort-card]").forEach((shell) => {
    shell.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", JSON.stringify({ playerId: Number(shell.dataset.sortPlayer), cardId: shell.dataset.sortCard }));
      event.dataTransfer.effectAllowed = "move";
    });
    shell.addEventListener("dragover", (event) => {
      event.preventDefault();
      shell.classList.add("is-drop-target");
    });
    shell.addEventListener("dragleave", () => shell.classList.remove("is-drop-target"));
    shell.addEventListener("drop", (event) => {
      event.preventDefault();
      shell.classList.remove("is-drop-target");
      const data = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
      const targetPlayer = Number(shell.dataset.sortPlayer);
      if (data.playerId !== targetPlayer) return;
      moveCard(targetPlayer, data.cardId, shell.dataset.sortCard);
    });
  });
}

function cardsInPlay() {
  return 104 - Object.values(state.removal).reduce((sum, sets) => sum + sets * 4, 0) + state.partialKeep.suits.length;
}

function removalSummary() {
  const parts = Object.entries(state.removal)
    .filter(([, sets]) => sets)
    .map(([rank, sets]) => `${sets === 2 ? "all" : "1 set of"} ${rank}s`);
  const restored = state.partialKeep.suits.length
    ? ` Kept ${state.partialKeep.suits.map((suitId) => `${state.partialKeep.rank}${suits.find((suit) => suit.id === suitId).symbol}`).join(", ")} from the final set.`
    : "";
  return parts.length ? `Removed ${parts.join(", ")}.${restored}` : "No cards removed.";
}

function renderSuitKeepOptions() {
  const rank = state.partialKeep.rank;
  $("partialRankLabel").textContent = rank ? `${rank}s` : "No partial set";
  $("suitKeepOptions").innerHTML = suits
    .map((suit) => {
      const active = state.partialKeep.suits.includes(suit.id);
      return `<button class="suit-toggle ${active ? "is-active" : ""}" data-keep-suit="${suit.id}" ${rank ? "" : "disabled"}>${suit.symbol} ${suit.name}</button>`;
    })
    .join("");
  document.querySelectorAll("[data-keep-suit]").forEach((button) => {
    button.addEventListener("click", () => {
      const suitId = button.dataset.keepSuit;
      const suitsKept = state.partialKeep.suits;
      state.partialKeep.suits = suitsKept.includes(suitId) ? suitsKept.filter((id) => id !== suitId) : [...suitsKept, suitId];
      render();
      publishTable();
    });
  });
}

function tableSnapshot() {
  return {
    ...state,
    passed: [...state.passed],
  };
}

function applyTableSnapshot(snapshot) {
  multiplayer.applying = true;
  Object.assign(state, snapshot, {
    passed: new Set(snapshot.passed || []),
  });
  populateTeamFormat();
  populatePlayerNames();
  populateCardsPerPlayer();
  populateRankRemoval();
  populateCardSelectors();
  populateDealSelectors();
  setStage(state.stage);
  multiplayer.applying = false;
}

async function createHostTable() {
  try {
    const response = await fetch("/api/tables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: tableSnapshot() }),
    });
    if (!response.ok) throw new Error("Multiplayer server unavailable");
    const table = await response.json();
    multiplayer.tableId = table.id;
    multiplayer.role = "host";
    multiplayer.version = table.version;
    history.replaceState({}, "", `${location.pathname}?table=${table.id}&role=host`);
    startTablePolling();
    render();
    setStatus(`Table ${table.id} is ready. Share the player links.`);
  } catch {
    setStatus("Open Blackqueen through the multiplayer server to create a table.");
  }
}

async function publishTable() {
  if (!multiplayer.tableId || multiplayer.applying) return;
  try {
    const response = await fetch(`/api/tables/${multiplayer.tableId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: tableSnapshot() }),
    });
    if (response.ok) {
      const result = await response.json();
      multiplayer.version = result.version;
    }
  } catch {
    setStatus("Table connection interrupted. Retrying automatically.");
  }
}

async function fetchTable(initial = false) {
  try {
    const response = await fetch(`/api/tables/${multiplayer.tableId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Table not found");
    const table = await response.json();
    if (initial || table.version > multiplayer.version) {
      multiplayer.version = table.version;
      applyTableSnapshot(table.state);
    }
  } catch {
    if (initial) setStatus("This multiplayer table could not be found.");
  }
}

function startTablePolling() {
  clearInterval(multiplayer.pollTimer);
  clearInterval(multiplayer.chatTimer);
  multiplayer.pollTimer = setInterval(() => fetchTable(false), 1200);
  multiplayer.chatTimer = setInterval(() => fetchMessages(false), 1200);
}

async function fetchMessages(initial = false) {
  if (!multiplayer.tableId) return;
  try {
    const response = await fetch(`/api/tables/${multiplayer.tableId}/messages?after=${initial ? 0 : multiplayer.lastMessageId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Chat unavailable");
    const result = await response.json();
    const incoming = result.messages || [];
    if (initial) multiplayer.messages = [];
    const known = new Set(multiplayer.messages.map((message) => message.id));
    incoming.forEach((message) => {
      if (!known.has(message.id)) multiplayer.messages.push(message);
    });
    if (incoming.length) {
      multiplayer.lastMessageId = Math.max(multiplayer.lastMessageId, ...incoming.map((message) => message.id));
      if (!multiplayer.chatOpen && !initial) multiplayer.unread += incoming.length;
      renderChat();
    }
  } catch {
    $("chatNote").textContent = "Chat connection interrupted. Retrying automatically.";
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = $("chatInput");
  const text = input.value.trim();
  if (!multiplayer.tableId || !text) return;
  $("chatSendBtn").disabled = true;
  try {
    const response = await fetch(`/api/tables/${multiplayer.tableId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, role: multiplayer.role, playerId: multiplayer.playerId }),
    });
    if (!response.ok) throw new Error("Message could not be sent");
    input.value = "";
    await fetchMessages(false);
    input.focus();
  } catch {
    $("chatNote").textContent = "Message could not be sent. Try again.";
  } finally {
    $("chatSendBtn").disabled = false;
  }
}

function toggleChat(open) {
  multiplayer.chatOpen = open;
  multiplayer.unread = open ? 0 : multiplayer.unread;
  renderChat();
  if (open) {
    $("chatInput").focus();
    fetchMessages(false);
  }
}

function renderChat() {
  const connected = Boolean(multiplayer.tableId);
  $("chatPanel").hidden = !multiplayer.chatOpen;
  $("chatLauncher").setAttribute("aria-expanded", String(multiplayer.chatOpen));
  $("chatLauncher").classList.toggle("is-open", multiplayer.chatOpen);
  $("chatBadge").hidden = multiplayer.unread === 0;
  $("chatBadge").textContent = multiplayer.unread > 99 ? "99+" : String(multiplayer.unread);
  $("chatInput").disabled = !connected;
  $("chatSendBtn").disabled = !connected;
  $("chatNote").textContent = connected
    ? `${multiplayer.role === "host" ? "Host" : state.players[multiplayer.playerId]?.name || "Player"} · Table ${multiplayer.tableId}`
    : "Create or join a multiplayer table to chat.";
  $("chatMessages").innerHTML = multiplayer.messages.length
    ? multiplayer.messages
        .map((message) => {
          const mine = message.role === multiplayer.role && (message.role === "host" || message.playerId === multiplayer.playerId);
          const time = new Date(message.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return `<div class="chat-message ${mine ? "is-mine" : ""}">
            <div class="chat-meta"><strong>${escapeHtml(message.author)}</strong><span>${escapeHtml(time)}</span></div>
            <p>${escapeHtml(message.text)}</p>
          </div>`;
        })
        .join("")
    : `<div class="chat-empty">No messages yet. Start the table talk.</div>`;
  const messages = $("chatMessages");
  messages.scrollTop = messages.scrollHeight;
}

function renderMultiplayer() {
  const label = multiplayer.tableId ? `${multiplayer.role === "host" ? "Host" : `Player ${Number(multiplayer.playerId) + 1}`} · ${multiplayer.tableId}` : "Local";
  $("roleLabel").textContent = label;
  $("createTableBtn").hidden = Boolean(multiplayer.tableId);
  $("joinLinks").innerHTML =
    multiplayer.tableId && multiplayer.role === "host"
      ? state.players
          .map((player) => {
            const link = `${location.origin}${location.pathname}?table=${multiplayer.tableId}&role=player&player=${player.id}`;
            const role = player.id === state.dealer ? "Dealer" : "Player";
            return `<a class="join-link" href="${link}" target="_blank" rel="noreferrer"><strong>${escapeHtml(player.name)}</strong><span>${role} link</span></a>`;
          })
          .join("")
      : "";
}

function applyRolePermissions() {
  if (!multiplayer.tableId) return;
  const isHost = multiplayer.role === "host";
  const isPlayer = multiplayer.role === "player";
  const isDealer = isPlayer && multiplayer.playerId === state.dealer;
  const isBidTurn = isPlayer && multiplayer.playerId === state.bidTurn;
  const isBidder = isPlayer && multiplayer.playerId === state.bidder;

  document.querySelectorAll("#setupStage input, #setupStage select, #setupStage button").forEach((control) => {
    if (control.id !== "createTableBtn") control.disabled = !isHost;
  });
  $("dealBtn").disabled = !isDealer;
  $("dealerSelect").disabled = !isHost;
  $("dealPattern").disabled = !isDealer;
  $("passBidBtn").disabled = !isBidTurn;
  $("raiseBidBtn").disabled = !isBidTurn;
  $("setBidderBtn").disabled = !isHost;
  $("bidHandPlayer").disabled = isPlayer;
  $("bidderSelect").disabled = !isBidder;
  $("bidAmount").disabled = !isBidder;
  $("trumpSuit").disabled = !isBidder;
  $("partnerCardA").disabled = !isBidder;
  $("partnerCardB").disabled = !isBidder;
  $("confirmCallBtn").disabled = !isBidder;
  $("scoreRoundBtn").disabled = !isHost || state.players.some((player) => player.hand.length) || state.scored;
  $("nextHandBtn").disabled = !isHost;
}

function cardPoints(card) {
  if (card.rank === "Q" && card.suit === "S") return 30;
  return pointMap[card.rank] || 0;
}

function cardHtml(card) {
  const suit = suits.find((item) => item.id === card.suit);
  const points = cardPoints(card);
  return `
    <span class="card ${suit.color}">
      <span class="corner">${card.rank}${suit.symbol}</span>
      <span class="suit">${suit.symbol}</span>
      ${points ? `<span class="points">${points}</span>` : ""}
    </span>
  `;
}

function sharedHandUrl(player) {
  const payload = {
    name: player.name,
    cards: player.hand.map(({ rank, suit, copy }) => ({ rank, suit, copy })),
  };
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  return `${location.href.split("?")[0]}?hand=${encoded}`;
}

function renderSharedHand() {
  const encoded = new URLSearchParams(location.search).get("hand");
  if (!encoded) return false;
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    payload = { name: "Player", cards: [] };
  }
  document.body.innerHTML = `
    <main class="app-shell player-only">
      <header class="topbar">
        <div>
          <p class="eyebrow">Blackqueen hand</p>
          <h1>${escapeHtml(payload.name || "Player")}</h1>
        </div>
        <div class="round-strip">
          <span>${payload.cards?.length || 0} cards</span>
        </div>
      </header>
      <section class="panel">
        <div class="cards shared-hand">
          ${(payload.cards || []).map((card) => cardHtml(card)).join("")}
        </div>
      </section>
    </main>
  `;
  return true;
}

function cardKey(card) {
  return `${card.rank}-${card.suit}`;
}

function cardLabel(card) {
  return cardLabelFromKey(cardKey(card));
}

function cardLabelFromKey(key) {
  const [rank, suitId] = key.split("-");
  const suit = suits.find((item) => item.id === suitId);
  return `${rank} of ${suit.name}`;
}

function suitName(suitId) {
  return suits.find((suit) => suit.id === suitId).name;
}

function roundedScore(score) {
  return Math.round(score);
}

function nextSeat(seat) {
  return (seat + 1) % state.playerCount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(message) {
  $("statusBand").textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

init();
