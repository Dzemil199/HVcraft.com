import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';


// =========================================================================
// 1. GLOBALNA PODEŠAVANJA SVETA
// =========================================================================
const CHUNK_SIZE = 16;
const RENDER_DIST_FRONT = 4; // Koliko čankova se vidi ispred
const RENDER_DIST_SIDE = 2;  // Koliko čankova se vidi sa strane
const RENDER_DIST_BACK = 1;  // Koliko čankova se vidi iza
const MAX_RENDER_DIST = Math.max(RENDER_DIST_FRONT, RENDER_DIST_SIDE, RENDER_DIST_BACK);
const WORLD_DEPTH = -5000; // Bedrok je sada na -5000!
const WORLD_HEIGHT = 80; // Povećano za visoke planine
const WATER_LEVEL = 10;      // Nivo vode za reke

// Keširane grupe čankova da ne bismo stalno alocirali memoriju u render petlji
const activeGroups = []; 

// Boje za čestice u zavisnosti od bloka koji kopamo
const blockColors = {
    grass: 0x55a030, dirt: 0x8b4513, stone: 0x7f7f7f,
    wood: 0xa0522d, glass: 0xaaaaaa, bedrock: 0x1a1a1a,
    leaves: 0x224416, water: 0x0044aa
};


// =========================================================================
// BRZI KEŠ (MEMOIZACIJA) - Ovo sprečava "Page Unresponsive" rušenje!
// =========================================================================
const heightCache = new Map();
const riverCache = new Map();
const treeCheckCache = new Map();
const treeBlocksCache = new Map();
const loadedChunks = new Map();
const modifiedBlocks = new Map();
const chunkLoadQueue = [];
let isGeneratingChunk = false;

// --- ZVUKOVI ---
// const mineSound = new Audio('sounds/mine.mp3');

function playSound(audio) {
    // audio.currentTime = 0; // Vraća zvuk na početak da bi mogao brzo da kopaš
    // audio.play().catch(e => console.log("Zvuk čeka da igrač klikne na igru."));
}

// const placeSound = new Audio('sounds/place.mp3');

// Dodaj preload da se fajl učita pre nego što zatreba
// placeSound.preload = 'auto';

function playPlaceSound() {
    // Provera da li je fajl spreman za puštanje
    // if (placeSound.readyState >= 2) { 
    //     placeSound.currentTime = 0; // Resetuj na početak
    //     placeSound.play().catch(e => console.log("Greška pri puštanju zvuka:", e));
    // } else {
    //     console.log("Zvuk se još učitava...");
    // }
}

// =========================================================================
// 2. INICIJALIZACIJA SCENE I KAMERE
// =========================================================================
const scene = new THREE.Scene();
// Postavi boju magle da odgovara boji neba (npr. svetlo plava)
scene.fog = new THREE.FogExp2(0x87ceeb, 0.02); 
scene.background = new THREE.Color(0x87ceeb); // I pozadinu neba

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// 1. AmbientLight - daje blago svetlo svuda, da ne bude totalni mrak u rupama
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
scene.add(ambientLight);

// 2. DirectionalLight - ovo je tvoje "Sunce", baca senke i daje dubinu terenu
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(50, 100, 50); // Postavlja sunce visoko na nebo
scene.add(sunLight);

// PointerLock Kontrole
const controls = new PointerLockControls(camera, document.body);

// =========================================================================
// EFEKAT PUCANJA BLOKOVA
// =========================================================================
// Funkcija koja crta crne linije pucanja direktno u memoriji
function createCrackTexture(stage) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    if (stage > 0) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'; // Crne pukotine
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Crtamo linije iz centra ka ivicama zavisno od stadijuma
        ctx.moveTo(32, 32);
        if (stage >= 1) { ctx.lineTo(10, 15); ctx.moveTo(32, 32); ctx.lineTo(55, 25); }
        if (stage >= 2) { ctx.moveTo(32, 32); ctx.lineTo(25, 55); ctx.moveTo(10, 15); ctx.lineTo(0, 30); }
        if (stage >= 3) { ctx.moveTo(32, 32); ctx.lineTo(50, 55); ctx.moveTo(55, 25); ctx.lineTo(64, 15); }
        if (stage >= 4) { ctx.moveTo(25, 55); ctx.lineTo(10, 64); ctx.moveTo(50, 55); ctx.lineTo(60, 64); }
        ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

// =========================================================================
// 3. PROCEDURALNE TEKSTURE (Canvas)
// =========================================================================
// Funkcija koja generiše teksturu u kodu
function createCodeTexture(baseColor, type) {
    const canvas = document.createElement('canvas');
    canvas.width = 128; // Veća rezolucija za više detalja
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // 1. Postavi osnovnu boju
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 128, 128);

    // 2. Dodaj detalje zavisno od tipa
    if (type === 'grass') {
        // Dodajemo nasumične "travčice" (tamnije zelene tačkice)
        ctx.fillStyle = '#3d7a2a';
        for(let i=0; i<300; i++) ctx.fillRect(Math.random()*128, Math.random()*128, 3, 3);
    } 
    else if (type === 'wood') {
        // Dodajemo "godove" (linije)
        ctx.strokeStyle = '#4a3220';
        ctx.lineWidth = 6;
        for(let i=0; i<128; i+=20) {
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(128, i);
            ctx.stroke();
        }
    } 
    else if (type === 'stone') {
        // Mrlje za pravi kameni izgled
        ctx.fillStyle = '#666666';
        for(let i=0; i<100; i++) {
            ctx.beginPath();
            ctx.arc(Math.random()*128, Math.random()*128, Math.random()*8, 0, Math.PI*2);
            ctx.fill();
        }
        // Dodatni detalji - pukotine i veneri kamena
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 1;
        for(let i=0; i<8; i++) {
            ctx.beginPath();
            ctx.moveTo(Math.random()*128, Math.random()*128);
            ctx.lineTo(Math.random()*128, Math.random()*128);
            ctx.stroke();
        }
    } 
    else if (type === 'bedrock') {
        // Crno-sivi bedrok sa geometrijskim šarama
        ctx.fillStyle = '#1a1a1a';
        for(let i=0; i<60; i++) {
            ctx.fillStyle = i % 3 === 0 ? '#333333' : '#111111';
            ctx.fillRect(Math.random()*128, Math.random()*128, Math.random()*15+3, Math.random()*15+3);
        }
    }
    else if (type === 'dirt') {
        // Dodajemo "zrnatost" zemlji
        ctx.fillStyle = '#5d3a1a';
        for(let i=0; i<500; i++) ctx.fillRect(Math.random()*128, Math.random()*128, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    // Ovo osigurava da tekstura ostane oštra (pixelated stil)
    texture.magFilter = THREE.NearestFilter; 
    return texture;
}

const materials = {
    grass: new THREE.MeshLambertMaterial({ map: createCodeTexture('#55a030', 'grass') }),
    dirt: new THREE.MeshLambertMaterial({ map: createCodeTexture('#8b4513', 'dirt') }),
    stone: new THREE.MeshLambertMaterial({ map: createCodeTexture('#7f7f7f', 'stone') }),
    wood: new THREE.MeshLambertMaterial({ map: createCodeTexture('#a0522d', 'wood') }),
    leaves: new THREE.MeshLambertMaterial({ map: createCodeTexture('#224416', 'leaves'), transparent: true, opacity: 0.9 }),
    water: new THREE.MeshLambertMaterial({ 
        color: 0x0000ff, 
        transparent: true, 
        opacity: 0.6,
        depthWrite: false
    }),
    glass: new THREE.MeshLambertMaterial({ 
        color: 0xeeeeee, 
        transparent: true, 
        opacity: 0.3 
    }),
    bedrock: new THREE.MeshLambertMaterial({ map: createCodeTexture('#111111', 'bedrock') })
};

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

// 5 različitih materijala pucanja (od 0 - ništa, do 4 - pred pucanje)
const crackMaterials = [
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }), // Nevidljivo
    new THREE.MeshBasicMaterial({ map: createCrackTexture(1), transparent: true, depthWrite: false }),
    new THREE.MeshBasicMaterial({ map: createCrackTexture(2), transparent: true, depthWrite: false }),
    new THREE.MeshBasicMaterial({ map: createCrackTexture(3), transparent: true, depthWrite: false }),
    new THREE.MeshBasicMaterial({ map: createCrackTexture(4), transparent: true, depthWrite: false })
];

// Pravimo kocku koja je 2% veća od pravog bloka da bi prekrila teksturu
const crackGeometry = new THREE.BoxGeometry(1.02, 1.02, 1.02);
const crackMesh = new THREE.Mesh(crackGeometry, crackMaterials[0]);
crackMesh.visible = false;
scene.add(crackMesh); // Dodajemo je u scenu, ali je nevidljiva

// =========================================================================
// 4. PROCEDURALNI ŠUM (Seed-ovan) & GENERISANJE TERENA
// =========================================================================
// Učitaj seed iz localStorage ako postoji (za persistentni svet), ili generiši novi
let seedX = parseFloat(localStorage.getItem('hvcraft_seedX')) || Math.random() * 50000;
let seedZ = parseFloat(localStorage.getItem('hvcraft_seedZ')) || Math.random() * 50000;
// Sačuvaj seed kako bi multiplayer koristio isti svet
localStorage.setItem('hvcraft_seedX', seedX);
localStorage.setItem('hvcraft_seedZ', seedZ);

function seededRandom2D(x, z) {
    const sx = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return sx - Math.floor(sx);
}

function smoothNoise(x, z) {
    const intX = Math.floor(x);
    const intZ = Math.floor(z);
    const fractX = x - intX;
    const fractZ = z - intZ;

    const v1 = seededRandom2D(intX, intZ);
    const v2 = seededRandom2D(intX + 1, intZ);
    const v3 = seededRandom2D(intX, intZ + 1);
    const v4 = seededRandom2D(intX + 1, intZ + 1);

    // Cosine interpolacija - čini da prelazi budu glatki i oblika prirodnih brda
    const fX = (1 - Math.cos(fractX * Math.PI)) * 0.5;
    const fZ = (1 - Math.cos(fractZ * Math.PI)) * 0.5;

    const i1 = v1 * (1 - fX) + v2 * fX;
    const i2 = v3 * (1 - fX) + v4 * fX;

    return i1 * (1 - fZ) + i2 * fZ;
}
// Generisanje pravih nasumičnih, vijugavih rečnih korita
function getRiverValue(x, z) {
    const key = `${x},${z}`;
    if (riverCache.has(key)) return riverCache.get(key);

    const nx = (x + seedX) * 0.005;
    const nz = (z + seedZ) * 0.005;
    
    // Mešamo dva različita šuma kako bi reke vrludale totalno nepredvidivo
    const val1 = smoothNoise(nx, nz) * 2 - 1;
    const val2 = smoothNoise(nx * 2 + 100, nz * 2 - 100) * 2 - 1;
    
    const val = (val1 * 0.7) + (val2 * 0.3);
    
    riverCache.set(key, val);
    return val;
}

// Generisanje potpuno nasumičnog terena (Planine, ravnice, udoline)
function getBaseHeight(x, z) {
	const nx = x + seedX;
	const nz = z + seedZ;

	// 1. MAKRO RELJEF (Biomi): Određuje da li smo u planinama ili na ravnici
	// Smanjili smo množenje (0.002) da bi ravnice i planinski venci bili ogromni i široki
	let macroNoise = smoothNoise(nx * 0.002, nz * 0.002) * 2 - 1;

	let terrainMultiplier;
	let isPlains = false;

	// Ako je makro šum ispod nule, smirujemo teren -> RAVNICA
	if (macroNoise < 0) {
		terrainMultiplier = 0.15; // Jako mali uticaj brda = blago talasasta ravnica
		isPlains = true;
	} else {
		// Ako je iznad nule, dižemo na kvadrat -> EKSTREMNE PLANINE
		terrainMultiplier = Math.pow(macroNoise, 1.5) * 5;
	}

	// 2. DETALJNI ŠUM: Oblikuje same ivice, mala brdašca i kamenje
	let amplitude = 30;
	let frequency = 0.015;
	let detailNoise = 0;

	for (let i = 0; i < 4; i++) {
		let n = smoothNoise(nx * frequency, nz * frequency) * 2 - 1;
		detailNoise += n * amplitude;

		amplitude *= 0.45;
		frequency *= 2.2;
	}

	// 3. SPAJANJE: Osnovna visina + (Detalji * Multiplikator Bioma)
	// Na ravnici baza je niža, u planinama teren raste
	let baseLevel = isPlains ? 22 : 24;
	let finalHeight = baseLevel + (detailNoise * terrainMultiplier);

	// 4. EFEKAT "LITICE" (Zadržavamo ga samo u planinama!)
	if (!isPlains) {
		let cliffNoise = smoothNoise(nx * 0.015, nz * 0.015);
		if (cliffNoise > 0.75) {
			finalHeight += 12; // Oštri zidovi samo tamo gde su planine
		}
	}

	return Math.floor(finalHeight);
}

// Konačna visina terena (gde reke iskopaju tlo) sa kešom
function getHeight(x, z) {
    const key = `${x},${z}`;
    if (heightCache.has(key)) return heightCache.get(key);

    const baseH = getBaseHeight(x, z);
    const riverVal = Math.abs(getRiverValue(x, z));
    let finalH = baseH;

    if (riverVal < 0.08) {
        const t = riverVal / 0.08;
        const carveFactor = Math.sin(t * Math.PI / 2);
        const targetY = WATER_LEVEL - 4; // Dubina korita reke
        const carvedH = Math.floor(THREE.MathUtils.lerp(targetY, baseH, carveFactor));
        finalH = Math.min(baseH, carvedH);
    }

    heightCache.set(key, finalH);
    return finalH;
}

function isCave(x, y, z) {
    const surfaceHeight = getHeight(x, z);
    // Pećine počinju tek 6 blokova ispod površine
    if (y >= surfaceHeight - 6) return false;
    // Ispod bedroka nema pećina
    if (y <= surfaceHeight - 78) return false;
    
    const nx = (x + seedX) * 0.04;
    const ny = y * 0.06;
    const nz = (z + seedZ) * 0.04;

    // Pećinski tuneli - dva talasa koji se ukrštaju
    const wave1 = Math.sin(nx) + Math.cos(ny * 1.2) + Math.sin(nz);
    const wave2 = Math.sin(nx * 1.7 - ny * 0.5) + Math.cos(nz * 1.7 + nx * 0.5);
    
    // Prag 0.7 = manje pećina ali veće i lepše
    const isTunnel = (Math.abs(wave1) < 0.7 && Math.abs(wave2) < 0.7);
    
    // Ogromne pećinske dvorane (retke)
    const cx = (x + seedX) * 0.02;
    const cy = y * 0.03;
    const cz = (z + seedZ) * 0.02;
    const caveRoom = Math.sin(cx * 2.3) * Math.cos(cy * 1.8) * Math.sin(cz * 2.1);
    const isRoom = caveRoom > 0.55;
    
    return isTunnel || isRoom;
}

// =========================================================================
// 5. DETERMINISTIČKO GENERISANJE DRVEĆA sa kešom
// =========================================================================
function hasTreeAt(x, z) {
    const key = `${x},${z}`;
    if (treeCheckCache.has(key)) return treeCheckCache.get(key);

    const riverVal = Math.abs(getRiverValue(x, z));
    if (riverVal < 0.12) {
        treeCheckCache.set(key, false);
        return false;
    }

    const baseH = getBaseHeight(x, z);
    if (baseH < WATER_LEVEL + 2) {
        treeCheckCache.set(key, false);
        return false;
    }

    const cellX = Math.floor(x / 6);
    const cellZ = Math.floor(z / 6);

    const rand = seededRandom2D(cellX, cellZ);
    if (rand > 0.35) {
        treeCheckCache.set(key, false);
        return false;
    }

    const localX = Math.floor(seededRandom2D(cellX * 13, cellZ * 37) * 6);
    const localZ = Math.floor(seededRandom2D(cellX * 7, cellZ * 53) * 6);

    const res = (x === cellX * 6 + localX && z === cellZ * 6 + localZ);
    treeCheckCache.set(key, res);
    return res;
}

// Konstruisanje stabla i lišća sa kešom
function getTreeBlocks(tx, tz) {
    const key = `${tx},${tz}`;
    if (treeBlocksCache.has(key)) return treeBlocksCache.get(key);

    const blocks = [];
    const surfaceH = getHeight(tx, tz);
    
    const trunkHeight = 4 + Math.floor(seededRandom2D(tx, tz) * 2);
    for (let h = 1; h <= trunkHeight; h++) {
        blocks.push({ x: tx, y: surfaceH + h, z: tz, type: 'wood' });
    }

    const topY = surfaceH + trunkHeight;

    for (let dy = -1; dy <= 0; dy++) {
        const ly = topY + dy;
        const r = (dy === 0) ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
                if (dx === 0 && dz === 0 && dy <= 0) continue;
                blocks.push({ x: tx + dx, y: ly, z: tz + dz, type: 'leaves' });
            }
        }
    }

    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            if (Math.abs(dx) === 1 && Math.abs(dz) === 1) continue;
            blocks.push({ x: tx + dx, y: topY + 1, z: tz + dz, type: 'leaves' });
        }
    }

    treeBlocksCache.set(key, blocks);
    return blocks;
}

function isTreeBlockAt(bx, by, bz) {
    for (let tx = bx - 2; tx <= bx + 2; tx++) {
        for (let tz = bz - 2; tz <= bz + 2; tz++) {
            if (hasTreeAt(tx, tz)) {
                const blocks = getTreeBlocks(tx, tz);
                for (let i = 0; i < blocks.length; i++) {
                    const tb = blocks[i];
                    if (tb.x === bx && tb.y === by && tb.z === bz) return true;
                }
            }
        }
    }
    return false;
}

// =========================================================================
// 6. SISTEM ČANKOVA & KOPANJE/GRADNJA
// =========================================================================

/*
// Primer alternativnog pristupa za generisanje blokova i pećina
// koristeći 3D šum. Zahteva implementaciju `noise3D` funkcije.
function getBlockType(x, y, z) {
    const surfaceHeight = getHeight(x, z); // Koristimo postojeću funkciju

    // Ako smo iznad zemlje, tu je vazduh
    if (y > surfaceHeight) return 'air'; 

    // Dodajemo 3D NOISE za pećine
    // Množimo sa malim brojem (npr. 0.05) da pećine budu velike i glatke
    const caveNoiseValue = noise3D(x * 0.05, y * 0.05, z * 0.05);

    // Ako je vrednost noise-a ispod neke granice (npr. -0.2), "klesemo" pećinu
    if (caveNoiseValue < -0.2) {
        return 'air'; 
    }

    // Ako smo na samoj površini, stavljamo travu
    if (y === surfaceHeight) return 'grass';
    
    // Sve ostalo ispod je kamen
    return 'stone';
}
*/

function hasBlockAt(bx, by, bz) {
    const key = `${bx},${by},${bz}`;
    if (modifiedBlocks.has(key)) {
        return modifiedBlocks.get(key).action === 'create';
    }
    if (by < WORLD_DEPTH || by > WORLD_HEIGHT) return false;

    const surfaceHeight = getHeight(bx, bz);

    // Bedrok sloj - uvek solidan (80 blokova ispod površine)
    const bedrockFloor = surfaceHeight - 80;
    if (by <= bedrockFloor) return true;

    // OPTIMIZACIJA: Drveće raste samo iznad zemlje! 
    // Preskakanje ovoga za podzemlje drastično ubrzava igru!
    if (by > surfaceHeight) {
        return isTreeBlockAt(bx, by, bz);
    }

    // Ako smo pod zemljom, provera za pećine
    if (isCave(bx, by, bz)) return false; 

    return true;
}

function isBlockExposed(x, y, z) {
    return !hasBlockAt(x+1, y, z) || !hasBlockAt(x-1, y, z) ||
           !hasBlockAt(x, y+1, z) || !hasBlockAt(x, y-1, z) ||
           !hasBlockAt(x, y, z+1) || !hasBlockAt(x, y, z-1);
}

// Primer kako se generiše slojeviti teren (konceptualno):
// Prolaziš kroz X i Z koordinate kao i do sada.
// for (let x = 0; x < sirinaSveta; x++) {
//     for (let z = 0; z < duzinaSveta; z++) {
        
//         // 1. Dobiješ visinu površine iz tvoje noise funkcije
//         let povrsinaY = Math.floor(tvojNoiseFunkcija(x, z) * maxVisina);

//         // 2. Petlja koja kreće od dna (y=0) do površine
//         for (let y = 0; y <= povrsinaY; y++) {
            
//             // Odlučujemo koji blok postavljamo u zavisnosti od dubine
//             if (y === povrsinaY) {
//                 // Na samom vrhu je trava
//                 napraviBlok(x, y, z, 'grass');
//             } else if (y > povrsinaY - 3) {
//                 // Odmah ispod trave je zemlja (dirt)
//                 napraviBlok(x, y, z, 'dirt');
//             } else {
//                 // Sve ispod toga je kamen
//                 napraviBlok(x, y, z, 'stone');
//             }
            
//         }
//     }
// }

// Dodaj parametar isImmediate = false (po defaultu je sporo za istraživanje)
async function generateChunk(cx, cz, isImmediate = false) {
    const chunkKey = `${cx},${cz}`;
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    const chunkGroup = new THREE.Group();
    loadedChunks.set(chunkKey, chunkGroup);
    scene.add(chunkGroup);
    const blocksByType = { grass: [], dirt: [], stone: [], wood: [], leaves: [], water: [], glass: [], bedrock: [] };
    for (let x = startX; x < startX + CHUNK_SIZE; x++) {
        // PAUZA SE DEŠAVA SAMO AKO NIJE "INSTANT" MOD
        if (!isImmediate && x % 4 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
            const surfaceHeight = getHeight(x, z);

            // Bedrok je 80 blokova ispod površine (vidljivi deo sveta)
            const UNDERGROUND_DEPTH = 80;
            const bedrockFloor = surfaceHeight - UNDERGROUND_DEPTH;

            // 1. GENERIŠEMO POVRŠINU + PODZEMLJE (kamen + pećine)
            for (let y = surfaceHeight; y >= bedrockFloor + 1; y--) {
                const blockKey = `${x},${y},${z}`;
                if (modifiedBlocks.has(blockKey) && modifiedBlocks.get(blockKey).action === 'delete') continue;
                
                if (!hasBlockAt(x, y, z)) continue; // Prazno = pećina ili vazduh
                if (!isBlockExposed(x, y, z)) continue; // Sakriven blok = preskoči

                let type;
                if (y === surfaceHeight) {
                    type = (y < WATER_LEVEL) ? 'dirt' : 'grass';
                } else if (y > surfaceHeight - 4) { // 3 bloka zemlje ispod trave
                    type = 'dirt';
                } else { // Sve ispod je kamen do bedroka
                    type = 'stone';
                }
                blocksByType[type].push({ x, y, z });
            }

            // 2. BEDROK SLOJ - nerazorivi pod sveta
            for (let by = bedrockFloor; by >= bedrockFloor - 2; by--) {
                const bedrockKey = `${x},${by},${z}`;
                if (modifiedBlocks.has(bedrockKey) && modifiedBlocks.get(bedrockKey).action === 'delete') continue;
                blocksByType['bedrock'].push({ x, y: by, z });
            }

            // 3. GENERIŠEMO VODU (ako je teren ispod nivoa vode)
            if (surfaceHeight < WATER_LEVEL) {
                for (let y = surfaceHeight + 1; y <= WATER_LEVEL; y++) {
                    const blockKey = `${x},${y},${z}`;
                    if (modifiedBlocks.has(blockKey) && modifiedBlocks.get(blockKey).action === 'delete') continue;

                    const isWaterExposed = (y === WATER_LEVEL) || !hasBlockAt(x+1, y, z) || !hasBlockAt(x-1, y, z) || !hasBlockAt(x, y, z+1) || !hasBlockAt(x, y, z-1);
                    if (isWaterExposed) blocksByType['water'].push({ x, y, z });
                }
            }
        }
    }

    // Dodavanje drveća na čankove
    for (let tx = startX - 2; tx < startX + CHUNK_SIZE + 2; tx++) {
        for (let tz = startZ - 2; tz < startZ + CHUNK_SIZE + 2; tz++) {
            if (hasTreeAt(tx, tz)) {
                const treeBlocks = getTreeBlocks(tx, tz);
                for (let i = 0; i < treeBlocks.length; i++) {
                    const tb = treeBlocks[i];
                    if (tb.x >= startX && tb.x < startX + CHUNK_SIZE &&
                        tb.z >= startZ && tb.z < startZ + CHUNK_SIZE) {
                        
                        const blockKey = `${tb.x},${tb.y},${tb.z}`;
                        if (modifiedBlocks.has(blockKey)) {
                            const mod = modifiedBlocks.get(blockKey);
                            if (mod.action === 'delete') continue;
                        }
                        blocksByType[tb.type].push({ x: tb.x, y: tb.y, z: tb.z });
                    }
                }
            }
        }
    }

    // Ručno dodati blokovi
    for (const [key, mod] of modifiedBlocks.entries()) {
        if (mod.action === 'create') {
            const [bx, by, bz] = key.split(',').map(Number);
            const blockChunkX = Math.floor(bx / CHUNK_SIZE);
            const blockChunkZ = Math.floor(bz / CHUNK_SIZE);

            if (blockChunkX === cx && blockChunkZ === cz) {
                blocksByType[mod.type].push({ x: bx, y: by, z: bz });
            }
        }
    }

    const dummy = new THREE.Object3D();

    for (const [type, list] of Object.entries(blocksByType)) {
        if (list.length === 0) continue;

        const material = materials[type];
        const instMesh = new THREE.InstancedMesh(blockGeometry, material, list.length);

        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            dummy.position.set(b.x, b.y, b.z);
            dummy.updateMatrix();
            instMesh.setMatrixAt(i, dummy.matrix);
        }

        instMesh.instanceMatrix.needsUpdate = true;
        instMesh.userData = { type: type };
        chunkGroup.add(instMesh);
    }

    // Provera za svaki slučaj - brišemo iz memorije ako je igrač pobegao daleko dok se ovo generisalo
    if (!loadedChunks.has(chunkKey)) {
        chunkGroup.traverse(child => { if (child.isInstancedMesh) child.dispose(); });
    }
}

function resetWorld() {
    // Uklanjanje svih čankova iz scene
    loadedChunks.forEach((group) => {
        scene.remove(group);
        group.traverse(child => { if (child.isInstancedMesh) child.dispose(); });
    });
    modifiedBlocks.clear();
    heightCache.clear();
    loadedChunks.clear();
    updateChunks();
}

function setWorldSeedAndReset(newSeedX, newSeedZ) {
    console.log("Primljen novi seed, resetujem svet...");
    seedX = newSeedX;
    seedZ = newSeedZ;
    resetWorld();
}

/**
 * Pronalazi čank na datoj poziciji, uklanja ga iz scene i memorije, 
 * i dodaje ga u red za ponovno, asinhrono generisanje.
 * Proverava i susedne čankove ako je izmena na ivici.
 */
function refreshChunksAround(blockX, blockZ) {
    const chunksToRefresh = new Set();
    const mainChunkX = Math.floor(blockX / CHUNK_SIZE);
    const mainChunkZ = Math.floor(blockZ / CHUNK_SIZE);
    chunksToRefresh.add(`${mainChunkX},${mainChunkZ}`);

    // Provera da li je blok na ivici čanka
    const modX = (blockX % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
    const modZ = (blockZ % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;

    if (modX === 0) chunksToRefresh.add(`${mainChunkX - 1},${mainChunkZ}`);
    if (modX === CHUNK_SIZE - 1) chunksToRefresh.add(`${mainChunkX + 1},${mainChunkZ}`);
    if (modZ === 0) chunksToRefresh.add(`${mainChunkX},${mainChunkZ - 1}`);
    if (modZ === CHUNK_SIZE - 1) chunksToRefresh.add(`${mainChunkX},${mainChunkZ + 1}`);

    chunksToRefresh.forEach(async key => { // dodaj async ovde
        const [cx, cz] = key.split(',').map(Number);
        
        // Ukloni staro
        if (loadedChunks.has(key)) {
            const group = loadedChunks.get(key);
            scene.remove(group);
            group.traverse(child => { if (child.isInstancedMesh) child.dispose(); });
            loadedChunks.delete(key);
        }
        
        // GENERIŠI ODMAH (isImmediate = true)
        await generateChunk(cx, cz, true);
        updateActiveGroups(); // osveži raycaster odmah nakon generisanja
    });
}

let currentChunkX = NaN, currentChunkZ = NaN, currentChunkAngle = NaN;
const playerDirection = new THREE.Vector3();

function updateChunks() {
    const pChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const pChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    controls.getDirection(playerDirection);
    const pAngle = Math.atan2(playerDirection.x, playerDirection.z);
    // Kvantizujemo ugao u 8 pravaca (svaki po 45 stepeni) da se ne bi ažuriralo na svaki mali pokret miša
    const pAngleDiscrete = Math.floor(pAngle / (Math.PI / 4));

    // Ažuriraj samo ako se igrač pomerio u novi čank ILI se okrenuo u novi pravac
    if (pChunkX === currentChunkX && pChunkZ === currentChunkZ && pAngleDiscrete === currentChunkAngle) return;

    currentChunkX = pChunkX;
    currentChunkZ = pChunkZ;
    currentChunkAngle = pAngleDiscrete;

    // Normalizujemo vektor pravca gledanja na XZ ravni
    const dirX = playerDirection.x;
    const dirZ = playerDirection.z;
    const dirLength = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (dirLength < 0.001) return; // Izbegavamo deljenje sa nulom ako igrač gleda pravo gore/dole
    const normDirX = dirX / dirLength;
    const normDirZ = dirZ / dirLength;

    const visibleChunks = new Set();

    // Prolazimo kroz maksimalno moguću kvadratnu oblast oko igrača
    for (let x = pChunkX - MAX_RENDER_DIST; x <= pChunkX + MAX_RENDER_DIST; x++) {
        for (let z = pChunkZ - MAX_RENDER_DIST; z <= pChunkZ + MAX_RENDER_DIST; z++) {
            
            const deltaX = x - pChunkX;
            const deltaZ = z - pChunkZ;

            // Projektujemo vektor do čanka na pravac gledanja igrača
            const forwardDist = deltaX * normDirX + deltaZ * normDirZ;
            // Projektujemo na vektor sa strane (desni)
            const sideDist = Math.abs(deltaX * -normDirZ + deltaZ * normDirX);

            // Proveravamo da li je čank unutar definisanog pravougaonika ispred/iza/sa strane
            if (forwardDist >= -RENDER_DIST_BACK && forwardDist <= RENDER_DIST_FRONT && sideDist <= RENDER_DIST_SIDE) {
                const chunkKey = `${x},${z}`;
                visibleChunks.add(chunkKey);

                if (!loadedChunks.has(chunkKey)) {
                    if (!chunkLoadQueue.some(c => c.x === x && c.z === z)) {
                        chunkLoadQueue.push({ x, z });
                    }
                }
            }
        }
    }

    // Uklanjamo čankove koji više nisu vidljivi
    for (const [key, chunkGroup] of loadedChunks.entries()) {
        if (!visibleChunks.has(key)) {
            scene.remove(chunkGroup);
            chunkGroup.traverse(child => {
                if (child.isInstancedMesh) child.dispose();
            });
            chunkGroup.clear();
            loadedChunks.delete(key);
        }
    }

    // NOVO: Brišemo iz reda one čankove koji više nisu vidljivi
    for (let i = chunkLoadQueue.length - 1; i >= 0; i--) {
        const qKey = `${chunkLoadQueue[i].x},${chunkLoadQueue[i].z}`;
        if (!visibleChunks.has(qKey)) {
            chunkLoadQueue.splice(i, 1);
        }
    }

    // Ažuriramo listu aktivnih grupa za raycasting
    updateActiveGroups();
}

function updateActiveGroups() {
    activeGroups.length = 0;
    for (const chunkGroup of loadedChunks.values()) {
        activeGroups.push(chunkGroup);
    }
}

async function processChunkQueue() {
    if (chunkLoadQueue.length === 0 || isGeneratingChunk) return;

    isGeneratingChunk = true;

    try {
        const pChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
        const pChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

        chunkLoadQueue.sort((a, b) => {
            const distA = Math.abs(a.x - pChunkX) + Math.abs(a.z - pChunkZ);
            const distB = Math.abs(b.x - pChunkX) + Math.abs(b.z - pChunkZ);
            return distA - distB;
        });

        const chunk = chunkLoadQueue.shift();
        const chunkKey = `${chunk.x},${chunk.z}`;
        
        // Samo ako već nije učitan (možda ga je updateChunks već sredio)
        if (!loadedChunks.has(chunkKey)) {
            await generateChunk(chunk.x, chunk.z);
        }
    } catch (error) {
        console.error("Greška pri generisanju čanka:", error);
    } finally {
        // OVO JE NAJVAŽNIJE: Otključava sistem bez obzira na sve
        isGeneratingChunk = false;
        
        // Opciono: osveži listu za raycasting (ako je potrebno)
        updateActiveGroups(); 
    }
}

console.log("Kamera je na:", camera.position);
// Kada se igra učita, postavljamo igrača na početnu poziciju.
const spawnX = 0;
const spawnZ = 0;
// Nađi koliko je visoka zemlja na toj tački
const spawnY = getHeight(spawnX, spawnZ);
// Postavi igrača malo IZNAD te visine (+3 bloka)
camera.position.set(spawnX, spawnY + 3, spawnZ);

// =========================================================================
// 7. SISTEM ČESTICA ZA KOPANJE (InstancedMesh)
// =========================================================================
class ParticleSystem {
    constructor(scene, maxParticles = 500) {
        const geometry = new THREE.BoxGeometry(0.08, 0.08, 0.08);
        const material = new THREE.MeshLambertMaterial();
        
        this.mesh = new THREE.InstancedMesh(geometry, material, maxParticles);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(this.mesh);

        this.particles = [];
        this.dummy = new THREE.Object3D();
        this.maxParticles = maxParticles;
        this.currentIndex = 0;

        for (let i = 0; i < maxParticles; i++) {
            this.dummy.scale.set(0, 0, 0);
            this.dummy.updateMatrix();
            this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
    }

    spawn(position, colorHex, count = 12) {
        const color = new THREE.Color(colorHex);
        for (let i = 0; i < count; i++) {
            const index = (this.currentIndex + i) % this.maxParticles;

            this.particles[index] = {
                position: position.clone().add(new THREE.Vector3(
                    (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.4,
                    (Math.random() - 0.5) * 0.4
                )),
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 3,
                    Math.random() * 3 + 1.5,
                    (Math.random() - 0.5) * 3
                ),
                scale: 1.0,
                life: 1.0
            };
            this.mesh.setColorAt(index, color);
        }
        this.currentIndex = (this.currentIndex + count) % this.maxParticles;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    update(deltaTime) {
        const gravity = -9.8;
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.particles[i];
            if (p && p.life > 0) {
                p.velocity.y += gravity * deltaTime;
                p.position.addScaledVector(p.velocity, deltaTime);

                // NOVO: Čestice se zaustavljaju kada udare u blok
                if (hasBlockAt(Math.floor(p.position.x), Math.floor(p.position.y), Math.floor(p.position.z))) {
                    p.life = 0;
                }

                p.life -= deltaTime * 2.5; 
                p.scale = Math.max(0, p.life);

                this.dummy.position.copy(p.position);
                this.dummy.scale.set(p.scale, p.scale, p.scale);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
            } else {
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
            }
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

const blockParticles = new ParticleSystem(scene, 500);

// =========================================================================
// 8. FIZIKA KRETANJA
// =========================================================================
const keys = { w: false, a: false, s: false, d: false, shift: false, space: false };
let vy = 0;
const gravity = -0.0075;
const jumpStrength = 0.14;
let canJump = false;
const playerRadius = 0.3;

// Inventar za survival mod
let inventory = {
    grass: 0, dirt: 0, stone: 0, wood: 0, leaves: 0, glass: 0, water: 0
};

// Niz za praćenje dropovanih itema u svetu
const droppedItems = [];

// Survival mehanike
let gameMode = 'survival'; // 'survival' ili 'creative'
let health = 20; // 10 srca, svako srce ima 2 poena
let peakY = camera.position.y; // Najviša tačka dostignuta u skoku/padu
let isFalling = false;

// Mining mehanike
let isMining = false;
let miningProgress = 0;
let currentMiningTarget = null; // Informacije o bloku koji se trenutno kopa

// Vreme kopanja u sekundama za Survival. Creative i dalje ruši blok odmah.
const SURVIVAL_MINING_TIME = Object.freeze({
    grass: 0.65,
    dirt: 0.55,
    leaves: 0.3,
    wood: 1.35,
    stone: 2.4,
    glass: 0.2,
    water: 0.1
});
const DEFAULT_SURVIVAL_MINING_TIME = 1.2;

function getSurvivalMiningTime(blockType) {
    return SURVIVAL_MINING_TIME[blockType] ?? DEFAULT_SURVIVAL_MINING_TIME;
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.w = true;
    if (e.code === 'KeyA') keys.a = true;
    if (e.code === 'KeyS') keys.s = true;
    if (e.code === 'KeyD') keys.d = true;
    if (e.code === 'ShiftLeft') keys.shift = true;
    
    if (e.code === 'Space') {
        keys.space = true; // Beležimo da je pritisnut
        // Običan skok radi samo ako nismo u vodi
        if (canJump && !checkInWater()) {
            vy = jumpStrength;
            canJump = false;
        }
    }
    
    // Sigurnosna provera: izvrši kod samo ako 'e.code' postoji
    if (e.code && e.code.startsWith('Digit')) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) changeActiveSlot(num);
        if (e.code === 'Digit0') changeActiveSlot(10);
    }
});

document.addEventListener('keyup', e => {
    if (e.code === 'KeyW') keys.w = false;
    if (e.code === 'KeyA') keys.a = false;
    if (e.code === 'KeyS') keys.s = false;
    if (e.code === 'KeyD') keys.d = false;
    if (e.code === 'Space') keys.space = false;
    if (e.code === 'ShiftLeft') keys.shift = false;
});

// KADA PUSTIŠ KLIK (Odustaješ od kopanja)
document.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        isMining = false;
        miningProgress = 0;
        crackMesh.visible = false; // Skloni pukotine
    }
});

let selectedBlock = 'grass';
function changeActiveSlot(index) {
    // Ažuriranje UI-a za 10 slotova
    const slotIndex = index === 10 ? 9 : index - 1;
    document.querySelectorAll('.slot').forEach((slot, i) => {
        const isActive = i === slotIndex;
        slot.classList.toggle('active', isActive);
        if (isActive) {
            selectedBlock = slot.dataset.type;
        }
    });
    console.log("Slot izabran: " + index);
}

function checkInWater() {
    // Proveravamo poziciju otprilike oko struka igrača
    const playerX = Math.floor(camera.position.x);
    const playerZ = Math.floor(camera.position.z);
    const playerY = camera.position.y - 1.0; 

    const surfaceH = getHeight(playerX, playerZ);

    // Ako je teren (dno reke) niži od površine, a mi smo unutar vode
    return (surfaceH < WATER_LEVEL && playerY <= WATER_LEVEL);
}

function getPlayerBox() {
    return {
        minX: camera.position.x - playerRadius,
        maxX: camera.position.x + playerRadius,
        minY: camera.position.y - 1.6,
        maxY: camera.position.y + 0.1,
        minZ: camera.position.z - playerRadius,
        maxZ: camera.position.z + playerRadius
    };
}

function checkCollision() {
    const box = getPlayerBox();
    const minX = Math.floor(box.minX);
    const maxX = Math.floor(box.maxX);
    const minY = Math.floor(box.minY);
    const maxY = Math.floor(box.maxY);
    const minZ = Math.floor(box.minZ);
    const maxZ = Math.floor(box.maxZ);

    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
                if (hasBlockAt(x, y, z)) {
                    const bMinX = x - 0.5, bMaxX = x + 0.5;
                    const bMinY = y - 0.5, bMaxY = y + 0.5;
                    const bMinZ = z - 0.5, bMaxZ = z + 0.5;

                    if (box.minX < bMaxX && box.maxX > bMinX &&
                        box.minY < bMaxY && box.maxY > bMinY &&
                        box.minZ < bMaxZ && box.maxZ > bMinZ) {
                        return { x, y, z, bMinX, bMaxX, bMinY, bMaxY, bMinZ, bMaxZ };
                    }
                }
            }
        }
    }
    return null;
}

function resolveCollisions(axis, dir) {
    let hit = checkCollision();
    if (!hit) return;

    if (axis === 'x' || axis === 'z') {
        const originalY = camera.position.y;
        camera.position.y += 1.05; 
        
        if (!checkCollision()) {
            vy = 0; 
            return;
        }
        camera.position.y = originalY; 
    }

    if (axis === 'x') {
        if (dir > 0) camera.position.x = hit.bMinX - playerRadius - 0.001;
        if (dir < 0) camera.position.x = hit.bMaxX + playerRadius + 0.001;
    }
    if (axis === 'z') {
        if (dir > 0) camera.position.z = hit.bMinZ - playerRadius - 0.001;
        if (dir < 0) camera.position.z = hit.bMaxX + playerRadius + 0.001;
    }
    if (axis === 'y') {
        if (dir > 0) {
            camera.position.y = hit.bMinY - 0.1 - 0.001;
            vy = 0;
        }
        if (dir < 0) {
            camera.position.y = hit.bMaxY + 1.6 + 0.001;
            vy = 0;
            canJump = true;
        }
    }
}

function movePlayer(dx, dy, dz) {
    camera.position.x += dx;
    resolveCollisions('x', dx);

    camera.position.z += dz;
    resolveCollisions('z', dz);

    camera.position.y += dy;
    resolveCollisions('y', dy);
}

// =========================================================================
// 9. INTERAKCIJA (KOPANJE I GRAĐENJE)
// =========================================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(0, 0);

document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('mousedown', (e) => {
    if (!controls.isLocked) return;

    // --- PVP HIT CHECK (za desni klik) ---
    // Prioritet je udarac, ako promašimo, onda se izvršava logika za postavljanje bloka
    if (e.button === 2) { // Desni klik
        // Prolazimo kroz sve online prijatelje da proverimo da li smo nekog udarili
        Object.values(onlineFriends).forEach(friend => {
            if (friend.avatar) {
                const distance = camera.position.distanceTo(friend.avatar.position);
                if (distance < 4) {
                    // TODO: Implementirati slanje 'hit' poruke
                }
            }
        });
    }

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(activeGroups, true);

    if (intersects.length > 0 && intersects[0].distance < 6) {
        const intersect = intersects[0];
        const instMesh = intersect.object;
        const instanceId = intersect.instanceId;

        const matrix = new THREE.Matrix4();
        instMesh.getMatrixAt(instanceId, matrix);
        const pos = new THREE.Vector3();
        pos.setFromMatrixPosition(matrix);

        const rx = Math.round(pos.x);
        const ry = Math.round(pos.y);
        const rz = Math.round(pos.z);
        const blockKey = `${rx},${ry},${rz}`;
        const blockType = instMesh.userData.type;

        if (e.button === 0) { // LEVI KLIK
            if (blockType === 'bedrock') return;

            if (gameMode === 'creative') {
                // CREATIVE: Odmah ruši blok!
                const particleColor = blockColors[blockType] || 0x737373;
                blockParticles.spawn(pos, particleColor, 12);
                modifiedBlocks.set(blockKey, { action: 'delete' });

                // Obavesti druge igrače o promeni
                broadcastData({
                    type: 'block-action',
                    action: 'break',
                    pos: { x: rx, y: ry, z: rz },
                    blockType: blockType
                });

                refreshChunksAround(rx, rz);
            } else if (gameMode === 'survival') {
                // SURVIVAL: Započni animaciju kopanja
                isMining = true;
                miningProgress = 0;
                // Čuvamo sve potrebne informacije o bloku koji se kopa
                currentMiningTarget = { key: blockKey, pos: pos.clone(), type: blockType, rx, ry, rz }; 
                
                // Postavi "pukotina" kocku tačno preko bloka u koji gledaš
                crackMesh.position.copy(currentMiningTarget.pos);
                crackMesh.visible = true;
                crackMesh.material = crackMaterials[0]; // Počni sa praznim
            }

        } else if (e.button === 2) { // DESNI KLIK - GRADNJA
            const normal = intersect.face.normal;
            const bx = rx + normal.x;
            const by = ry + normal.y;
            const bz = rz + normal.z;

            // U survival modu, proveri da li imamo blok u inventaru
            if (gameMode === 'survival') {
                if (inventory[selectedBlock] > 0) {
                    inventory[selectedBlock]--;
                    updateInventoryUI();
                } else {
                    // Nema dovoljno blokova, ne radi ništa
                    return;
                }
            }

            const playerFeetY = camera.position.y - 1.6;
            const overlapX = Math.abs(bx - camera.position.x) < 0.6;
            const overlapZ = Math.abs(bz - camera.position.z) < 0.6;
            const overlapY = (by + 0.5 > playerFeetY) && (by - 0.5 < camera.position.y);

            if (!(overlapX && overlapY && overlapZ)) {
                modifiedBlocks.set(`${bx},${by},${bz}`, { action: 'create', type: selectedBlock });
                refreshChunksAround(bx, bz);

                // Obavesti druge igrače o postavljanju bloka
                broadcastData({
                    type: 'block-action',
                    action: 'place',
                    pos: { x: bx, y: by, z: bz },
                    blockType: selectedBlock
                });
            }
        }
    }
});

function createItemDrop(position, type) {
    // Implementacija će biti dodata kasnije
}


// Selekcioni okvir
const highlightBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 })
);
scene.add(highlightBox);

// =========================================================================
// 10. MOBILNE KONTROLE
// =========================================================================

function setupMobileControls() {
    // Prikaži mobilne komande
    document.getElementById('mobile-controls').style.display = 'flex';
    
    // Zaobilazimo PointerLock na mobilnom i ručno aktiviramo igru
    controls.isLocked = true; // Varamo engine da pomisli da je miš zaključan kako bi radilo kretanje

    // 1. Gledanje okolo (Touch Look) pomoću prevlačenja prsta
    let touchStartX = 0, touchStartY = 0;
    let euler = new THREE.Euler(0, 0, 0, 'YXZ');
    
    document.addEventListener('touchstart', (e) => {
        if (e.target.classList.contains('mob-btn') || e.target.classList.contains('slot')) return;
        touchStartX = e.touches[0].pageX;
        touchStartY = e.touches[0].pageY;
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (e.target.classList.contains('mob-btn') || e.target.classList.contains('slot')) return;
        e.preventDefault(); // Sprečavamo skrolovanje browsera
        
        const dx = e.touches[0].pageX - touchStartX;
        const dy = e.touches[0].pageY - touchStartY;
        
        euler.setFromQuaternion(camera.quaternion);
        euler.y -= dx * 0.005; // Osetljivost levo-desno
        euler.x -= dy * 0.005; // Osetljivost gore-dole
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x)); // Ograničavanje okretanja preko glave
        
        camera.quaternion.setFromEuler(euler);
        
        touchStartX = e.touches[0].pageX;
        touchStartY = e.touches[0].pageY;
    }, { passive: false });

    // 2. Mapiranje tastera za kretanje na tvoj postojeći "keys" objekat
    const bindBtn = (id, keyName) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); keys[keyName] = true; });
        btn.addEventListener('touchend', (e) => { e.preventDefault(); keys[keyName] = false; });
    };

    bindBtn('btn-w', 'w');
    bindBtn('btn-a', 'a');
    bindBtn('btn-s', 's');
    bindBtn('btn-d', 'd');

    // 3. Skok
    document.getElementById('btn-jump').addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (canJump) { 
            vy = jumpStrength; 
            canJump = false; 
        }
    });

    // 4. Interakcija (Kopanje i Građenje prilagođeno telefonu)
    function mobInteract(action) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(activeGroups, true);
        
        if (intersects.length > 0 && intersects[0].distance < 6) {
            const intersect = intersects[0];
            const instMesh = intersect.object;
            const instanceId = intersect.instanceId;

            const matrix = new THREE.Matrix4();
            instMesh.getMatrixAt(instanceId, matrix);
            const pos = new THREE.Vector3();
            pos.setFromMatrixPosition(matrix);

            const rx = Math.round(pos.x);
            const ry = Math.round(pos.y);
            const rz = Math.round(pos.z);
            const blockKey = `${rx},${ry},${rz}`;

            if (action === 'mine') { // Na mobilnom, kopanje je uvek instant kao u creative modu
                if (instMesh.userData.type === 'bedrock') return;

                // playSound(mineSound);

                const particleColor = blockColors[instMesh.userData.type] || 0x737373;
                blockParticles.spawn(pos, particleColor, 12);
                modifiedBlocks.set(blockKey, { action: 'delete' });
                refreshChunksAround(rx, rz);

                // Obavesti druge igrače
                broadcastData({
                    type: 'block-action',
                    action: 'break',
                    pos: { x: rx, y: ry, z: rz },
                    blockType: instMesh.userData.type
                });

            } else if (action === 'place') {
                const normal = intersect.face.normal;
                const bx = rx + normal.x;
                const by = ry + normal.y;
                const bz = rz + normal.z;

                const playerFeetY = camera.position.y - 1.6;
                const overlapX = Math.abs(bx - camera.position.x) < 0.6;
                const overlapZ = Math.abs(bz - camera.position.z) < 0.6;
                const overlapY = (by + 0.5 > playerFeetY) && (by - 0.5 < camera.position.y);

                if (!(overlapX && overlapY && overlapZ)) {
                    modifiedBlocks.set(`${bx},${by},${bz}`, { action: 'create', type: selectedBlock });
                    // playSound(placeSound);
                    refreshChunksAround(bx, bz);

                    // Obavesti druge igrače
                    broadcastData({
                        type: 'block-action',
                        action: 'place',
                        pos: { x: bx, y: by, z: bz },
                        blockType: selectedBlock
                    });
                }
            }
        }
    }

    document.getElementById('btn-mine').addEventListener('touchstart', (e) => { e.preventDefault(); mobInteract('mine'); });
    document.getElementById('btn-place').addEventListener('touchstart', (e) => { e.preventDefault(); mobInteract('place'); });

    // 5. Biranje blokova pritiskom na hotbar na dnu ekrana
    document.querySelectorAll('.slot').forEach((slot, index) => {
        slot.addEventListener('touchstart', (e) => {
            e.preventDefault();
            changeActiveSlot(index === 9 ? 10 : index + 1);
        });
    });
}

// =========================================================================
// 11. KORISNIČKI INTERFEJS (UI)
// =========================================================================

// Ažurira prikaz broja itema na hotbaru
function updateInventoryUI() {
    if (gameMode !== 'survival') return;
    document.querySelectorAll('.slot').forEach(slot => {
        const type = slot.dataset.type;
        if (inventory.hasOwnProperty(type)) {
            const countSpan = slot.querySelector('.item-count');
            if (countSpan) {
                const count = inventory[type];
                countSpan.innerText = count > 0 ? count : '';
            }
        }
    });
}



// --- AUTHENTICATION ---
let isLoginMode = true; // Prati da li se logujemo ili pravimo nalog

// Proverava da li smo već ulogovani kada se stranica učita
// Kreiraj friend request notification
function showPendingRequestsUI() {
    let notifHTML = '';
    pendingRequests.forEach(username => {
        notifHTML += `
            <div style="background: #333; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #4CAF50;">
                <strong>${username}</strong> te je dodao!
                <button onclick="acceptFriendReq('${username}')" style="padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 10px;">Prihvati</button>
                <button onclick="rejectFriendReq('${username}')" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; margin-left: 5px;">Odbij</button>
            </div>
        `;
    });
    
    if (notifHTML) {
        let container = document.getElementById('friend-requests-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'friend-requests-container';
            container.style.cssText = 'position: fixed; top: 20px; left: 20px; max-width: 350px; z-index: 999; max-height: 300px; overflow-y: auto;';
            document.body.appendChild(container);
        }
        container.innerHTML = notifHTML;
    }
}

window.addEventListener('load', () => {
    const savedUser = localStorage.getItem('hvcraft_user_email');
    if (savedUser) {
        // Ako postoji sačuvan email, sakrij auth ekran
        console.log("Dobrodošao nazad, " + savedUser);
        document.getElementById('auth-screen').style.display = 'none';
    } else {
        // Ako ne postoji, sakrij glavni meni dok se ne uloguje
        document.getElementById('overlay').style.display = 'none';
    }
});

// Menja tekst između "Uloguj se" i "Kreiraj nalog"
window.toggleAuthMode = function() {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "Uloguj se" : "Kreiraj nalog";
    document.querySelector('#auth-screen button').innerText = isLoginMode ? "Uđi u igru" : "Kreiraj i uđi";
    document.querySelector('#auth-screen p').innerHTML = isLoginMode 
        ? 'Nemaš nalog? <span onclick="window.toggleAuthMode()" style="color: #4CAF50; cursor: pointer; text-decoration: underline;">Kreiraj ga ovde</span>.'
        : 'Već imaš nalog? <span onclick="window.toggleAuthMode()" style="color: #4CAF50; cursor: pointer; text-decoration: underline;">Uloguj se</span>.';
}

// Funkcija koja se poziva kada klikneš "Uđi u igru"
window.handleAuth = function() {
    const email = document.getElementById('email-input').value;
    const password = document.getElementById('password-input').value;

    if (email === "" || password === "") {
        alert("Moraš uneti email i šifru!");
        return;
    }

    if (isLoginMode) {
        // Proveravamo šifru sa onom sačuvanom u sistemu
        const savedPassword = localStorage.getItem('hvcraft_pass_' + email);
        if (savedPassword === password) {
            loginSuccess(email);
        } else if (savedPassword) {
            alert("Pogrešna šifra!");
        } else {
            alert("Nalog ne postoji. Molimo kreirajte ga prvo.");
        }
    } else {
        // KREIRANJE NALOGA
        localStorage.setItem('hvcraft_pass_' + email, password);
        alert("Nalog uspešno kreiran!");
        loginSuccess(email);
    }
}

// Kada je login uspešan, pamtimo te i sklanjamo ekran
function loginSuccess(email) {
    localStorage.setItem('hvcraft_user_email', email); // Pamti te i za sledeći put
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('overlay').style.display = 'flex'; // Prikaži glavni meni
    console.log("Ulogovan kao: " + email);
    document.getElementById('current-username-display').innerText = email;
}

// Funkcija za Logout (ako zatreba)
window.logout = function() {
    localStorage.removeItem('hvcraft_user_email');
    location.reload(); // Osvežava stranicu i vraća te na početni ekran
}

// --- HEALTH & DEATH SCREEN ---
function updateHearts() {
    const heartBar = document.getElementById('heart-bar');
    heartBar.innerHTML = ''; // Briše sve preostale elemente
    
    for (let i = 0; i < 10; i++) {
        const heart = document.createElement('div');
        heart.style.width = '30px';
        heart.style.height = '30px';
        heart.style.margin = '2px';
        heart.style.display = 'inline-block';
        
        // Ako je (i * 2 + 2) <= health, srce je puno, inače je prazno
        if (i * 2 + 2 <= health) {
            heart.style.backgroundColor = '#ff0000'; // Puno srce
        } else {
            heart.style.backgroundColor = '#444444'; // Prazno srce
        }
        
        // Dodajemo zaobljenost da izgleda kao srce
        heart.style.borderRadius = '50%';
        heartBar.appendChild(heart);
    }
}

function showDeathScreen() {
    document.getElementById('death-screen').style.display = 'flex';
    controls.unlock(); // Otključaj miša da možeš da klikneš na dugme
}

// Mora biti globalna funkcija da bi je 'onclick' atribut video
window.respawn = function() {
    health = 20; // Vrati život na puno
    document.getElementById('death-screen').style.display = 'none';
    
    // Vrati igrača na početnu poziciju i resetuj brzinu
    camera.position.set(0, getHeight(0,0) + 3, 0); 
    vy = 0;
    
    controls.lock(); // Vrati PointerLock da igra nastavi
    updateHearts();
}

// --- PAUSE MENU ---
const pauseMenu = document.getElementById('pause-menu');

// Kreiraj online friends panel
function createOnlineFriendsPanel() {
    let html = '<div style="position: absolute; right: 20px; top: 20px; background: rgba(0,0,0,0.8); padding: 15px; border-radius: 8px; color: #fff; font-family: Arial; max-width: 200px;">';
    html += '<h3 style="margin: 0 0 10px 0; color: #4CAF50;">Online Prijatelji</h3>';
    
    const onlineFriendsList = Object.entries(friendsList).filter(([_, data]) => data.status === 'online');
    
    if (onlineFriendsList.length === 0) {
        html += '<p style="margin: 5px 0; color: #aaa;">Nema online prijatelja</p>';
    } else {
        onlineFriendsList.forEach(([username, data]) => {
            html += `<p style="margin: 5px 0; color: #4CAF50;">🟢 ${username}</p>`;
        });
    }
    
    html += '<button onclick="inviteFriend()" style="margin-top: 10px; padding: 8px 12px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;">Invite Friend</button>';
    html += '</div>';
    
    return html;
}

// Ažuriraj online friends listu
function updateOnlineFriendsList() {
    let friendsPanel = document.getElementById('online-friends-panel');
    if (!friendsPanel) {
        friendsPanel = document.createElement('div');
        friendsPanel.id = 'online-friends-panel';
        document.body.appendChild(friendsPanel);
    }
    
    if (controls.isLocked) {
        friendsPanel.innerHTML = createOnlineFriendsPanel();
        friendsPanel.style.display = 'block';
    } else {
        friendsPanel.style.display = 'none';
    }
}

// Slušamo kada igrač zaključa ili otključa miša (ESC)
document.addEventListener('pointerlockchange', () => {
    // Proveravamo da li je miš otključan
    if (document.pointerLockElement !== document.body) {
        // Miš je otključan (Pritisnut ESC) -> PRIKAŽI MENI I PAUZIRAJ
        if (document.getElementById('death-screen').style.display !== 'flex') {
            pauseMenu.style.display = 'flex';
            // Dodaj "Add Friend" dugme u pause meni ako ne postoji
            if (!document.getElementById('pause-menu-add-friend-btn')) {
                const addFriendBtn = document.createElement('button');
                addFriendBtn.id = 'pause-menu-add-friend-btn';
                addFriendBtn.innerText = 'Add Friend';
                addFriendBtn.className = 'mc-btn';
                addFriendBtn.style.width = '420px';
                addFriendBtn.onclick = () => {
                    pauseMenu.style.display = 'none';
                    document.getElementById('multiplayer-menu').style.display = 'flex';
                    document.getElementById('screen-main').classList.remove('active');
                };
                const saveAndQuitBtn = pauseMenu.querySelector('button[onclick="saveAndQuit()"]');
                pauseMenu.insertBefore(addFriendBtn, saveAndQuitBtn);
            }
        }
        isMining = false; 
        if (typeof crackMesh !== 'undefined') crackMesh.visible = false;
    } else {
        // Miš je ponovo zaključan -> SAKRIJ MENI I NASTAVI
        pauseMenu.style.display = 'none';
        updateOnlineFriendsList();
    }
});

// Funkcija za dugme "Back to Game"
window.resumeGame = function() {
    // Ponovo tražimo kontrolu nad mišem, što automatski sklanja meni
    document.body.requestPointerLock();
}

// Funkcija za pozivanje prijatelja
window.inviteFriend = function() {
    if (Object.keys(friendsList).length === 0) {
        alert("Nemaš prijatelja! Prvo dodaj prijatelja preko Add Friend.");
        return;
    }

    const friendList = Object.keys(friendsList).join('\n');
    const friendToInvite = prompt("Tvoji prijatelji:\n" + friendList + "\n\nKoga pozivas?");
    
    if (friendToInvite && friendsList[friendToInvite]) {
        // Pošalji invite
        const seedData = {
            type: 'game-invite',
            from: currentUser,
            seedX: seedX,
            seedZ: seedZ
        };
        console.log("Slanje poziva " + friendToInvite);
        alert("Poziv poslat " + friendToInvite + "!");
    }
}

// Funkcija za dugme "Save and Quit to Title"
window.saveAndQuit = function() {
    // Čuvamo koordinate igrača i seed sveta u localStorage pre izlaska
    localStorage.setItem('hvcraft_last_x', camera.position.x);
    localStorage.setItem('hvcraft_last_y', camera.position.y);
    localStorage.setItem('hvcraft_last_z', camera.position.z);
    localStorage.setItem('hvcraft_seedX', seedX);
    localStorage.setItem('hvcraft_seedZ', seedZ);
    
    // Osvežava stranicu i vraća nas na početni ekran
    location.reload(); 
}

// =========================================================================
// FRIEND SISTEM
// =========================================================================
let peer = null;
let currentUser = "";
let myPeerId = "";
let friendsList = {};      // { username: { status: 'online'/'offline', peerId: '...', avatar: {...} } }
let pendingRequests = [];   // Zahtevi koji čekaju prihvatanje
let onlineFriends = {};    // Prati koje prijatelje vidim online

function initFriendSystem() {
    currentUser = localStorage.getItem('hvcraft_user_email');
    if (!currentUser) {
        console.log("Korisnik nije ulogovan, friend sistem nije aktivan.");
        return;
    }
    
    // Inicijalizujemo Peer sa korisničkim imenom kao ID-jem
    peer = new Peer(currentUser);

    peer.on('open', function(id) {
        myPeerId = id;
        console.log("Moj Peer ID je:", id);
    });

    peer.on('connection', function(connection) {
        const friendUsername = connection.peer;
        console.log(`Dolazna konekcija od: ${friendUsername}`);

        // Proveravamo da li je korisnik na listi prijatelja
        if (friendsList[friendUsername]) {
            onlineFriends[friendUsername] = {
                conn: connection,
                // ostali podaci (avatar, pozicija) će biti dodati kasnije
            };
            console.log(`${friendUsername} je sada online.`);

            connection.on('data', (data) => handleFriendData(data));

            connection.on('close', () => {
                console.log(`Konekcija sa ${friendUsername} je zatvorena.`);
                if (onlineFriends[friendUsername] && onlineFriends[friendUsername].avatar) {
                    scene.remove(onlineFriends[friendUsername].avatar);
                }
                delete onlineFriends[friendUsername];
            });
        } else {
            // Ovo je verovatno friend request od nekoga ko nije na listi
            connection.on('data', handleFriendData);
        }    });

    loadFriendsList();
}

function handleFriendData(data) {
    if (data.type === 'FRIEND_REQUEST') {
        console.log(`Dobio si zahtev za prijateljstvo od: ${data.username}`);
        // Prikazuje novi modal prozor umesto stare notifikacije
        prikaziZahtevNaEkranu(data.username);

        if (!pendingRequests.includes(data.username)) {
            pendingRequests.push(data.username);
            savePendingRequests();
        }
        // Ažurira listu u meniju
        if (typeof window.updatePendingRequestsUI === 'function') {
            window.updatePendingRequestsUI();
        }
    } else if (data.type === 'REQUEST_ACCEPTED') {
        // Prijatelj je prihvatio zahtev
        if (!friendsList[data.username]) {
            friendsList[data.username] = { status: 'online', peerId: data.from }; // data.from je peerId pošiljaoca
            saveFriendsList();
            if (typeof window.updateFriendsListUI === 'function') {
                window.updateFriendsListUI();
            }
            alert(`${data.username} je prihvatio tvoj zahtev!`);
        }
    } else if (data.type === 'player-move') {
        // Ažuriranje pozicije prijatelja
        const friend = onlineFriends[data.username];
        if (friend) {
            // Ako avatar ne postoji, kreiraj ga
            if (!friend.avatar) {
                friend.avatar = createPlayerAvatar(data.username);
                scene.add(friend.avatar);
                console.log(`Kreiran avatar za ${data.username}`);
            }
            // Ažuriraj poziciju i rotaciju
            friend.avatar.position.set(data.position.x, data.position.y, data.position.z);
            if (data.quaternion) {
                 friend.avatar.quaternion.set(data.quaternion._x, data.quaternion._y, data.quaternion._z, data.quaternion._w);
            }
        }
    } else if (data.type === 'block-action') {
        const { pos, action, blockType } = data;
        const blockKey = `${pos.x},${pos.y},${pos.z}`;

        if (action === 'place') {
            modifiedBlocks.set(blockKey, { action: 'create', type: blockType });
            refreshChunksAround(pos.x, pos.z);
        } else if (action === 'break') {
            const posVec = new THREE.Vector3(pos.x, pos.y, pos.z);
            
            // Prikazujemo čestice kao da je blok uništen
            const particleColor = blockColors[blockType] || 0x737373;
            blockParticles.spawn(posVec, particleColor, 12);

            modifiedBlocks.set(blockKey, { action: 'delete' });
            refreshChunksAround(pos.x, pos.z);
        }
    } else if (data.type === 'hit') {
        // Prijatelj te je udario
        health = Math.max(0, health - data.damage);
        updateHearts();
    }
}

function saveFriendsList() {
    localStorage.setItem('hvcraft_friends_' + currentUser, JSON.stringify(friendsList));
}

function savePendingRequests() {
    localStorage.setItem('hvcraft_pending_' + currentUser, JSON.stringify(pendingRequests));
}

function loadFriendsList() {
    const saved = localStorage.getItem('hvcraft_friends_' + currentUser);
    // Sigurnosna provera u slučaju da su podaci oštećeni
    friendsList = (saved && saved !== 'undefined') ? JSON.parse(saved) : {};
}

// Pronalaženje igrača po username-u (u bazi svih registrovanih korisnika)
// Kratka proverna veza osvežava online/offline status bez ponovnog učitavanja igre.
window.refreshFriendStatuses = function() {
    if (!peer || !currentUser) return;

    Object.entries(friendsList).forEach(([username, friend]) => {
        const probe = peer.connect(username);
        let settled = false;
        const updateStatus = (status) => {
            if (settled) return;
            settled = true;
            friend.status = status;
            saveFriendsList();
            if (typeof window.updateFriendsListUI === 'function') window.updateFriendsListUI();
            if (probe.open) probe.close();
        };
        probe.on('open', () => updateStatus('online'));
        probe.on('error', () => updateStatus('offline'));
    });
};

function searchPlayer(username) {
    // Proveravamo da li je user registrovan (ako postoji password za njega)
    return localStorage.getItem('hvcraft_pass_' + username) ? username : null;
}

function sendFriendRequest(targetUsername) {
    if (!targetUsername) return;
    
    if (targetUsername === currentUser) {
        alert("Ne možeš dodati samog sebe!");
        return;
    }

    if (friendsList && friendsList[targetUsername]) {
        alert("Već si prijatelj sa ovim korisnikom!");
        return;
    }

    console.log("Povezujem se sa igračem: " + targetUsername + "...");
    
    // Povezujemo se sa drugim igračem preko njegovog imena (koje je sada PeerID)
    const conn = peer.connect(targetUsername);

    conn.on('open', () => {
        // Kada se veza otvori, pošalji JSON sa tipom zahteva
        conn.send({
            type: 'FRIEND_REQUEST',
            username: currentUser
        });
        console.log("Zahtev uspesno poslat!");
        alert(`Zahtev za prijateljstvo je poslat igraču ${targetUsername}!`);
    });

    conn.on('error', (err) => {
        console.error("Greška pri konekciji za friend request:", err);
        alert("Nije moguće poslati zahtev. Korisnik je možda offline.");
    });
}

function acceptFriendRequest(fromUsername) {
    if (!friendsList[fromUsername]) {
        friendsList[fromUsername] = { status: 'offline', peerId: null };
    }
    saveFriendsList();

    // Potvrdi zahtev pošiljaocu i odmah osveži status na obe strane.
    const acceptedConnection = peer.connect(fromUsername);
    acceptedConnection.on('open', () => {
        acceptedConnection.send({
            type: 'REQUEST_ACCEPTED',
            username: currentUser,
            from: myPeerId
        });
        friendsList[fromUsername].status = 'online';
        friendsList[fromUsername].peerId = fromUsername;
        saveFriendsList();
        if (typeof window.updateFriendsListUI === 'function') window.updateFriendsListUI();
    });
    acceptedConnection.on('error', () => {
        friendsList[fromUsername].status = 'offline';
        saveFriendsList();
        if (typeof window.updateFriendsListUI === 'function') window.updateFriendsListUI();
    });

    // Ukloni iz pending
    pendingRequests = pendingRequests.filter(u => u !== fromUsername);
    savePendingRequests();

    // Ažuriraj UI
    if (typeof window.updatePendingRequestsUI === 'function') window.updatePendingRequestsUI();
    if (typeof window.updateFriendsListUI === 'function') window.updateFriendsListUI();
}

function rejectFriendRequest(fromUsername) {
    pendingRequests = pendingRequests.filter(u => u !== fromUsername);
    savePendingRequests();
    if (typeof window.updatePendingRequestsUI === 'function') window.updatePendingRequestsUI();
}

function loadPendingRequests() {
    const saved = localStorage.getItem('hvcraft_pending_' + currentUser);
    pendingRequests = (saved && saved !== 'undefined') ? JSON.parse(saved) : [];
}

function updateFriendsUI() {
    // Ažuriranje liste prijatelja na desnoj strani tokom igre
    // (implementira se kasnije u pause menu)
}

// PRIKAZIVANJE PROZORČIĆA I DUGMIĆA
let trenutniKojiTrazi = null;

function prikaziZahtevNaEkranu(odKoga) {
    trenutniKojiTrazi = odKoga; // Pamtimo ko nam je poslao zahtev
    document.getElementById('requester-name').innerText = odKoga;
    document.getElementById('friend-request-modal').style.display = 'block';
}

// Učitaj pending friend requests pri pokretanju
function checkIncomingFriendRequests() {
    loadPendingRequests();
    // Logika za prikazivanje starih zahteva je sada u 'multiplayer-menu'
    // Ova funkcija se može proširiti ako je potrebno
}

// Kreiraj avatar kao na slici - pixel art stil
function createPlayerAvatar(username) {
    const group = new THREE.Group();
    
    // Glava (crna)
    const headGeometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const headMaterial = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 0.6;
    group.add(head);

    // Oči (bela i zelena)
    const eyeGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const eyeMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    leftEye.position.set(-0.08, 0.7, 0.21);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    rightEye.position.set(0.08, 0.7, 0.21);
    group.add(rightEye);

    // Telo (tirkizna ciliana)
    const bodyGeometry = new THREE.BoxGeometry(0.4, 0.5, 0.2);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x00ccaa });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.15;
    group.add(body);

    // Leve ruke (tamno smeđa)
    const armGeometry = new THREE.BoxGeometry(0.15, 0.5, 0.15);
    const armMaterial = new THREE.MeshLambertMaterial({ color: 0x996633 });
    const leftArm = new THREE.Mesh(armGeometry, armMaterial);
    leftArm.position.set(-0.28, 0.2, 0);
    group.add(leftArm);

    // Desne ruke
    const rightArm = new THREE.Mesh(armGeometry, armMaterial);
    rightArm.position.set(0.28, 0.2, 0);
    group.add(rightArm);

    // Noge (purpurne pantalone)
    const legGeometry = new THREE.BoxGeometry(0.15, 0.4, 0.15);
    const legMaterial = new THREE.MeshLambertMaterial({ color: 0x663366 });
    const leftLeg = new THREE.Mesh(legGeometry, legMaterial);
    leftLeg.position.set(-0.12, -0.3, 0);
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeometry, legMaterial);
    rightLeg.position.set(0.12, -0.3, 0);
    group.add(rightLeg);

    // Cipele (tamne - siva)
    const shoeGeometry = new THREE.BoxGeometry(0.18, 0.1, 0.18);
    const shoeMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const leftShoe = new THREE.Mesh(shoeGeometry, shoeMaterial);
    leftShoe.position.set(-0.12, -0.55, 0);
    group.add(leftShoe);

    const rightShoe = new THREE.Mesh(shoeGeometry, shoeMaterial);
    rightShoe.position.set(0.12, -0.55, 0);
    group.add(rightShoe);

    group.userData = { username: username, type: 'friend' };
    return group;
}

// Slanje pozicije svim online prijateljima
function broadcastPlayerPosition() {
    if (!currentUser || Object.keys(onlineFriends).length === 0) return;
    
    Object.entries(onlineFriends).forEach(([username, friend]) => {
        if (friend && friend.conn && friend.conn.open) {
            try {
                friend.conn.send({
                    type: 'player-move',
                    username: currentUser,
                    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
                    quaternion: camera.quaternion
                });
            } catch(e) {
                console.log("Greška pri slanju pozicije:", e);
            }
        }
    });
}

// Generička funkcija za slanje podataka svim online prijateljima
function broadcastData(data) {
    if (!currentUser) return;
    Object.values(onlineFriends).forEach(friend => {
        if (friend && friend.conn && friend.conn.open) {
            try {
                friend.conn.send(data);
            } catch (e) {
                console.error("Greška pri slanju podataka prijatelju:", e);
            }
        }
    });
}
// --- MENIJI, SVETOVI I START IGRE ---
const screenMain = document.getElementById('screen-main');
const screenSelect = document.getElementById('screen-select');
const screenCreate = document.getElementById('screen-create');
const screenDevice = document.getElementById('screen-device');

// --- UPRAVLJANJE SVETOVIMA (localStorage) ---

// Čuvanje liste svetova
function saveWorldList(worldsArray) {
    localStorage.setItem('hv_worlds', JSON.stringify(worldsArray));
}

// Učitavanje liste svetova pri pokretanju
function loadWorldList() {
    const saved = localStorage.getItem('hv_worlds');
    return saved ? JSON.parse(saved) : []; // Vraća praznu listu ako nema ničega
}

// Ažuriranje prikaza liste svetova na ekranu
function updateWorldUI() {
    const worlds = loadWorldList();
    const listElement = document.querySelector('#screen-select .world-list');
    
    listElement.innerHTML = ''; // Brišemo staru listu
    
    if (worlds.length === 0) {
        listElement.innerHTML = '<div class="world-item" style="color: #888; text-align: center;">No worlds found.</div>';
    } else {
        worlds.forEach((worldName, idx) => {
            const worldDiv = document.createElement('div');
            worldDiv.className = 'world-item' + (idx === 0 ? ' selected' : '');
            worldDiv.dataset.name = worldName;
            worldDiv.innerHTML = `${worldName}<br><span>Survival Mode, Cheats, Version: 1.0</span>`;
            worldDiv.addEventListener('click', () => {
                document.querySelectorAll('#screen-select .world-item').forEach(el => el.classList.remove('selected'));
                worldDiv.classList.add('selected');
            });
            listElement.appendChild(worldDiv);
        });
    }
}

// Kreiranje novog sveta
function createNewWorld(name) {
    let worlds = loadWorldList();
    if (worlds.includes(name)) return; // Ne dozvoljavamo duplikate
    worlds.push(name);
    saveWorldList(worlds);
    // Sačuvaj novi nasumični seed za ovaj svet
    const newSeedX = Math.random() * 50000;
    const newSeedZ = Math.random() * 50000;
    localStorage.setItem('hvcraft_seed_' + name + '_X', newSeedX);
    localStorage.setItem('hvcraft_seed_' + name + '_Z', newSeedZ);
    updateWorldUI();
}

// Pomoćna funkcija za promenu ekrana
function showScreen(screen) {
    document.querySelectorAll('.menu-screen').forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

// Postavi default mod za novi svet
let selectedWorldMode = 'survival'; 

window.toggleGameMode = function() {
    const btn = document.getElementById('mode-toggle-btn');
    if (selectedWorldMode === 'survival') {
        selectedWorldMode = 'creative';
        btn.innerText = 'Game Mode: Creative';
    } else {
        selectedWorldMode = 'survival';
        btn.innerText = 'Game Mode: Survival';
    }
    
    // Na kraju, postavi glavni gameMode na izabrani
    // Ovo će se primeniti kada se svet učita
    gameMode = selectedWorldMode; 
}

// Navigacija iz Glavnog Menija
document.getElementById('btn-singleplayer').addEventListener('click', () => {
    updateWorldUI(); // Osveži listu svaki put kad se uđe u meni
    showScreen(screenSelect);
});

// Navigacija iz Select World
document.getElementById('btn-go-create').addEventListener('click', () => showScreen(screenCreate));
document.getElementById('btn-cancel-select').addEventListener('click', () => showScreen(screenMain));
document.getElementById('btn-play-world').addEventListener('click', () => {
    // Učitaj seed za izabrani svet (ako postoji)
    const worlds = loadWorldList();
    const selectedWorldEl = document.querySelector('#screen-select .world-item.selected');
    if (selectedWorldEl) {
        const worldName = selectedWorldEl.dataset.name;
        const wx = parseFloat(localStorage.getItem('hvcraft_seed_' + worldName + '_X'));
        const wz = parseFloat(localStorage.getItem('hvcraft_seed_' + worldName + '_Z'));
        if (!isNaN(wx) && !isNaN(wz)) {
            seedX = wx;
            seedZ = wz;
            // Ažuriraj globalni seed u localStorage
            localStorage.setItem('hvcraft_seedX', seedX);
            localStorage.setItem('hvcraft_seedZ', seedZ);
            resetWorld();
        }
    }
    showScreen(screenDevice);
});

// Navigacija iz Create World
document.getElementById('btn-cancel-create').addEventListener('click', () => showScreen(screenSelect));
document.getElementById('btn-create-world').addEventListener('click', () => {
    const worldNameInput = document.querySelector('#screen-create .mc-input');
    const worldName = worldNameInput.value.trim();
    if (!worldName) return; // Ne kreiraj svet bez imena
    createNewWorld(worldName);
    showScreen(screenSelect); // Vrati se na listu da vidiš novi svet
});

// Inicijalizuj friend sistem umesto multiplayer-a
document.getElementById('btn-multiplayer').addEventListener('click', (event) => {
    // 1. Sprečava da se klik prenese na canvas ili document
    event.stopPropagation(); 
    
    // 2. Logika za otvaranje menija
    console.log("Add Friend clicked!");
    document.getElementById('multiplayer-menu').style.display = 'flex';
    document.getElementById('overlay').style.display = 'none'; // Sakrij glavni meni
    if (typeof window.refreshFriendsList === 'function') window.refreshFriendsList();
});

window.acceptFriendReq = function(username) {
    acceptFriendRequest(username);
};

window.rejectFriendReq = function(username) {
    rejectFriendRequest(username);
};

// Finalno pokretanje igre (Device izbor)
document.getElementById('start-desktop').addEventListener('click', () => {
    // Inicijalizuj friend sistem za single player
    initFriendSystem();
    checkIncomingFriendRequests();
    
    controls.lock();
    updateHearts(); updateInventoryUI(); // Inicijalni prikaz UI
    document.getElementById('overlay').style.display = 'none';
    updateOnlineFriendsList();
});

document.getElementById('start-mobile').addEventListener('click', () => {
    setupMobileControls();
    updateHearts(); updateInventoryUI(); // Inicijalni prikaz UI
    document.getElementById('overlay').style.display = 'none';
});

// Osluškujemo kada se stranica potpuno učita
document.addEventListener('DOMContentLoaded', () => {
    const myUsername = localStorage.getItem('hvcraft_user_email');
    if (myUsername) {
        document.getElementById('current-username-display').innerText = myUsername;
    }

    // KLIK NA DUGME "PRIHVATI"
    document.getElementById('btn-accept-friend').addEventListener('click', () => {
        if (trenutniKojiTrazi) {
            acceptFriendRequest(trenutniKojiTrazi); // Pozivamo postojeću funkciju
            document.getElementById('friend-request-modal').style.display = 'none';
            alert(`Prihvatio si zahtev! ${trenutniKojiTrazi} je sada tvoj prijatelj.`);
            // Osvežavamo UI u meniju
            if (typeof window.updateFriendsListUI === 'function') window.updateFriendsListUI();
        }
    });

    // KLIK NA DUGME "ODBIJ"
    document.getElementById('btn-decline-friend').addEventListener('click', () => {
        if (trenutniKojiTrazi) {
            rejectFriendRequest(trenutniKojiTrazi); // Pozivamo postojeću funkciju
            document.getElementById('friend-request-modal').style.display = 'none';
        }
    });

    // ========== AUTOCOMPLETE PRETRAGA PRIJATELJA ==========
    const getAllPlayers = () => {
        const players = [];
        // Iteriramo kroz sve ključeve u localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // Ako ključ počinje sa prefiksom za šifru, to je igrač
            if (key.startsWith('hvcraft_pass_')) {
                // Uklanjamo prefiks da dobijemo čisto korisničko ime
                players.push(key.replace('hvcraft_pass_', ''));
            }
        }
        return players;
    };

    const searchInput = document.getElementById('search-player-input');
    const resultsContainer = document.getElementById('search-results');

    if (searchInput && resultsContainer) {
        // 'input' event se pokreće svaki put kad ukucaš ili obrišeš slovo
        searchInput.addEventListener('input', (event) => {
            const unos = event.target.value.toLowerCase();
            resultsContainer.innerHTML = ''; 

            if (unos.length === 0) {
                resultsContainer.style.display = 'none';
                return;
            }

            const sviIgraciUBazi = getAllPlayers();
            // Filtriramo niz - ostavljamo samo one koji POČINJU na ta slova i nisu trenutni korisnik
            const pronadjeniIgraci = sviIgraciUBazi.filter(igrac => 
                igrac.toLowerCase().startsWith(unos) && igrac.toLowerCase() !== currentUser.toLowerCase()
            );

            if (pronadjeniIgraci.length > 0) {
                resultsContainer.style.display = 'block'; // Prikaži padajuću listu
                
                pronadjeniIgraci.forEach(igrac => {
                    const divIgraca = document.createElement('div');
                    divIgraca.innerText = igrac;
                    divIgraca.style.cssText = 'padding: 10px; color: white; cursor: pointer; border-bottom: 1px solid #555;';

                    divIgraca.onmouseover = () => divIgraca.style.background = '#4CAF50';
                    divIgraca.onmouseout = () => divIgraca.style.background = 'transparent';

                    divIgraca.onclick = () => {
                        searchInput.value = igrac; // Ime se upisuje gore u polje
                        resultsContainer.style.display = 'none'; // Lista se zatvara
                        sendFriendRequest(igrac); // Odmah pozivamo funkciju za slanje zahteva!
                    };
                    resultsContainer.appendChild(divIgraca);
                });
            } else {
                resultsContainer.style.display = 'none';
            }
        });

        // Opcija: Sakrij listu ako klikneš negde drugde na ekranu
        document.addEventListener('click', (event) => {
            if (event.target !== searchInput) {
                resultsContainer.style.display = 'none';
            }
        });
    }
});

// =========================================================================
// 12. GLAVNA PETLJA IGRE (GAME LOOP)
// =========================================================================
const clock = new THREE.Clock();
let raycastThrottle = 0; 
const tempMatrix = new THREE.Matrix4(); 
const tempPos = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = Math.min(clock.getDelta(), 0.1);
    blockParticles.update(deltaTime);

    // --- ITEM PICKUP & MULTIPLAYER BROADCAST ---
    if (controls.isLocked) {
        // Šalji poziciju svim online prijateljima (u intervalima radi optimizacije)
        if (raycastThrottle % 3 === 0) {
            broadcastPlayerPosition();
        }

        // Logika za sakupljanje itema
        if (gameMode === 'survival') {
            for (let i = droppedItems.length - 1; i >= 0; i--) {
                const drop = droppedItems[i];
                drop.mesh.rotation.y += 0.05; // Rotacija

                const distance = camera.position.distanceTo(drop.mesh.position);
                if (distance < 1.5) { // Domet sakupljanja
                    if (inventory.hasOwnProperty(drop.type)) inventory[drop.type]++;
                    updateInventoryUI();
                    scene.remove(drop.mesh);
                    droppedItems.splice(i, 1);
                }
            }
        }
    }
    
    if (isMining && currentMiningTarget) {
        // Provera da li igrač i dalje gleda u isti blok
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(activeGroups, true);
        let stillOnTarget = false;
        if (intersects.length > 0 && intersects[0].distance < 6) {
            const instMesh = intersects[0].object;
            instMesh.getMatrixAt(intersects[0].instanceId, tempMatrix);
            const currentTargetKey = `${Math.round(tempPos.setFromMatrixPosition(tempMatrix).x)},${Math.round(tempPos.y)},${Math.round(tempPos.z)}`;
            if (currentTargetKey === currentMiningTarget.key) {
                stillOnTarget = true;
            }
        }

        if (stillOnTarget) {
            // Punimo progress (prilagođeno za deltaTime, ~2 sekunde po bloku)
            const miningTime = getSurvivalMiningTime(currentMiningTarget.type);
            miningProgress += (deltaTime / miningTime) * 100;
            
            // Menjamo fazu pukotina zavisno od progresa
            const stage = Math.min(4, Math.floor(miningProgress / 20));
            crackMesh.material = crackMaterials[stage];

            // Kad stigne do 100, puklo je!
            if (miningProgress >= 100) {
                const { key, pos, type, rx, ry, rz } = currentMiningTarget;
                
                const particleColor = blockColors[type] || 0x737373;
                blockParticles.spawn(pos, particleColor, 12);

                // Kreiraj dropovani item koji igrač može da pokupi
                createItemDrop(pos, type);

                modifiedBlocks.set(key, { action: 'delete' });
                refreshChunksAround(rx, rz);

                // Obavesti druge igrače o uništenju bloka
                broadcastData({
                    type: 'block-action',
                    action: 'break',
                    pos: { x: rx, y: ry, z: rz },
                    blockType: type
                });
                
                isMining = false;
                crackMesh.visible = false;
                currentMiningTarget = null;
            }
        } else {
            // Igrač se pomerio, prekini kopanje
            isMining = false;
            crackMesh.visible = false;
        }
    }

    // Funkcija za kreiranje dropovanog itema
    createItemDrop = function(position, type) {
        if (!materials[type] || type === 'water') return;

        const dropGeometry = new THREE.BoxGeometry(0.25, 0.25, 0.25);
        const dropMesh = new THREE.Mesh(dropGeometry, materials[type]);
        dropMesh.position.copy(position);
        
        const drop = {
            mesh: dropMesh,
            type: type,
        };

        scene.add(dropMesh);
        droppedItems.push(drop);
    }

    if (controls.isLocked) {
        updateChunks();
        processChunkQueue();

        const pChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
        const pChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
        const chunkKey = `${pChunkX},${pChunkZ}`;

        const oldX = camera.position.x;
        const oldZ = camera.position.z;

        let moveSpeed = keys.shift ? 0.17 : 0.1;
        const inWater = checkInWater();

        if (inWater) {
            moveSpeed *= 0.5; // Kretanje je sporije kroz vodu
            vy += gravity * 0.2; // Mnogo sporije toneš
            if (vy < -0.05) vy = -0.05; // Terminalna brzina padanja u vodi
            
            if (keys.space) {
                vy = 0.05; // Plivanje nagore
            }
        } else {
            // Standardna gravitacija za kopno
            if (loadedChunks.has(chunkKey)) {
                vy += gravity;
            } else {
                vy = 0; 
            }
        }

        if (keys.w) controls.moveForward(moveSpeed);
        if (keys.s) controls.moveForward(-moveSpeed);
        if (keys.a) controls.moveRight(-moveSpeed);
        if (keys.d) controls.moveRight(moveSpeed);

        const dx = camera.position.x - oldX;
        const dz = camera.position.z - oldZ;

        camera.position.x = oldX;
        camera.position.z = oldZ;

        movePlayer(dx, vy, dz);

        // --- FALL DAMAGE LOGIKA ---
        if (gameMode === 'survival') {
            // 1. Ako počnemo da padamo (vy je negativan a nismo već bili u padu)
            if (vy < 0 && !isFalling) {
                isFalling = true;
                peakY = camera.position.y; // Beležimo visinu sa koje je pad počeo
            }
            
            // 2. Ako smo sleteli (vy je 0, a bili smo u padu)
            if (vy === 0 && isFalling) {
                // Nema štete od pada ako sletimo u vodu
                if (!checkInWater()) {
                    const fallDistance = peakY - camera.position.y;
                    
                    // Šteta se računa samo za padove veće od 3 bloka
                    if (fallDistance > 3) {
                        // Formula: (visina_pada - 3) = damage poeni (svaki poen je pola srca)
                        const damage = Math.floor(fallDistance - 3);
                        
                        if (damage > 0) {
                            health = Math.max(0, health - damage); // Ne dozvoli da health ide ispod 0
                            updateHearts(); // Ažuriraj prikaz srca
                            console.log(`Pao si sa ${fallDistance.toFixed(1)} blokova! Primljen damage: ${damage}. Health: ${health}`);
                            
                            if (health <= 0) showDeathScreen();
                        }
                    }
                }
                isFalling = false; // Resetujemo stanje pada nakon sletanja
            }
        } else {
            isFalling = false; // U Creative modu nema pada, pa samo resetujemo
        }

        // --- VIZUELNI EFEKAT: Magla u zavisnosti od okoline ---
        const playerSurfH = getHeight(Math.floor(camera.position.x), Math.floor(camera.position.z));
        const isUnderground = camera.position.y < playerSurfH - 4 && hasBlockAt(
            Math.floor(camera.position.x), Math.floor(camera.position.y + 2), Math.floor(camera.position.z));

        if (camera.position.y < WATER_LEVEL + 0.2 && playerSurfH < WATER_LEVEL) {
            // Pod vodom - plava magla
            scene.fog.color.setHex(0x1e90ff);
            scene.fog.density = 0.15;
            scene.background.setHex(0x1e90ff);
        } else if (isUnderground) {
            // U pećini - tamna sivo-crna magla
            scene.fog.color.setHex(0x111111);
            scene.fog.density = 0.08;
            scene.background.setHex(0x111111);
        } else {
            // Na površini - boja neba
            scene.fog.color.setHex(0x87ceeb);
            scene.fog.density = 0.03;
            scene.background.setHex(0x87ceeb);
        }

        if (camera.position.y < WORLD_DEPTH - 5) {
            camera.position.set(0, getHeight(0,0) + 3, 0);
            vy = 0;
        }

        raycastThrottle++;
        if (raycastThrottle % 4 === 0) {
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(activeGroups, true);

            if (intersects.length > 0 && intersects[0].distance < 6) {
                const instMesh = intersects[0].object;
                const instanceId = intersects[0].instanceId;
                
                instMesh.getMatrixAt(instanceId, tempMatrix);
                tempPos.setFromMatrixPosition(tempMatrix);

                highlightBox.position.copy(tempPos);
                highlightBox.visible = true;
            } else {
                highlightBox.visible = false;
            }
        }
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


updateChunks();
animate();
