// Development only: whiteboards with an old thumbnail (white background baked in) and a new
// one (dark mode, transparent), to check the boards list (?boards=1).
const now = Math.floor(Date.now() / 1000);
const OLD = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAYAAAABtjuPAAAB7klEQVR4nO3dQWrlQBQEQZ/E97/lzKqhabyc7yKZCNC+eORKIPT1B4a+1gP4vwmQKQEyJUCmBMiUAJkSIFMCZEqATAmQKQEyJUCmBMiUAJkSIFMCZEqATAmQKQEyJUCmPhLg9/d3/uF3CFCAUx8NsKi8vUiAj/L2IgE+ytuLBPgoby8S4KO8vUiAj/L2IgE+ytuLBPgoby8S4KO6vfoSXYCP6nYBXoqHOKrbBXgpHuKobhfgpXiIo7pdgJfiIY7qdgFeioc4qtsFeCke4qhuF+CleIijul2Al+Ihjup2AV6Khziq2wV4KR7iqG4X4KV4iKO6XYCX4iGOT26/I6k+/5oAHwIU4JQABThV3f7JSD5JgI/qdgFeioc4qtsFeCke4qhuF+CleIijul2Al+Ihjup2AV6Khziq2wV4KR7iqG4X4KV4iKO6XYCX4iGO6nYBXoqHOKrbBXgpHuKobhfgpXiIo7pdgJfiIY7y9iIBPsrbiwT4KG8vEuCjvL1IgI/y9iIBPsrbiwT4KG8vEuCjvL3I3zJ/6esvfiZAAU75YzpTAmRKgEwJkCkBMiVApgTIlACZEiBTAmRKgEwJkCkBMiVApgTIlACZEiBTAmRKgEwJkCkBMiVApgTIlACZEiBTAmRKgEwJkCkBMiVApv4C8afjhFADJ58AAAAASUVORK5CYII=";
const NEW = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAYAAAABtjuPAAABdUlEQVR4nO3bMYokURBDwbn/Gfsus04aYhhn6W2Kx0bA94VSVkF9fQEAAAAAAAAAAAAAAAA87fV6fdff0x3yhqfHY4D/ufIRy9k55SOWs3PKRyxn55SPWM7OKR+xnJ1TPmI5O6d8xHJ2TvmI5eyc8hGr2X1EH+UiqtkNcJSLqGY3wFEuoprdAEe5iGp2AxzlIqrZDXCUi6hmN8BRLqKa3QBHuYhqdgMc5SKq2Q1wlIuoZjfAUS6imt0AR7mIanYDHOUiPpl9R1J9n+jln0uF/cEADfBRBmiAj6pmz43kk8pFVLMb4CgXUc1ugKNcRDW7AY5yEdXsBjjKRVSzG+AoF1HNboCjXEQ1uwGOchHV7AY4ykVUsxvgKBdRzW6Ao1xENbsBjnIR1ewGOMpFlLNzykcsZ+eUj1jOzikfsZydUz5iOTunfMRydk75iOXsnPIRy9k5v/1NVXtPd8gbnh6PAQIAAAAAAAAAAAAAAAAAAAAAAAB/7w+4n2SUbEryjgAAAABJRU5ErkJggg==";

export const boards = [
  { id: "b1", name: "Architecture secured", project: null, thumb: NEW, position: 1, createdAt: now - 86_400, updatedAt: now - 3600, elements: 14 },
  { id: "b2", name: "Ancien schéma (avant 1.0)", project: null, thumb: OLD, position: 0, createdAt: now - 9 * 86_400, updatedAt: now - 8 * 86_400, elements: 6 },
  { id: "b3", name: "Vide", project: null, thumb: null, position: 0, createdAt: now - 3 * 86_400, updatedAt: now - 2 * 86_400, elements: 0 },
];
