import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// =========================================================================
// 1. GLOBALNA PODEŠAVANJA SVETA
// =========================================================================
const CHUNK_SIZE = 16;       
const RENDER_DIST = 1;       // STAVI NA 1 (Bilo je 2). Ovo drastično smanjuje broj čankova na početku!
const WORLD_DEPTH = -20;
const WORLD_HEIGHT = 80; // Povećano za visoke planine
const WATER_LEVEL = 10;      // Nivo vode za reke

// Keširane grupe čankova da ne bismo stalno alocirali memoriju u render petlji
const activeGroups = []; 

// Boje za čestice u zavisnosti od bloka koji kopamo
const blockColors = {
    grass: 0x777777, dirt: 0x555555, stone: 0x888888,
    wood: 0x666666, glass: 0xaaaaaa, bedrock: 0x333333,
    leaves: 0x444444, water: 0x999999
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

// =========================================================================
// 2. INICIJALIZACIJA SCENE I KAMERE
// =========================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.03);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Svetlo
const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.35);
sunLight.position.set(10, 80, 10);
scene.add(sunLight);

// PointerLock Kontrole
const controls = new PointerLockControls(camera, document.body);
document.getElementById('overlay').addEventListener('click', () => controls.lock());

// =========================================================================
// 3. PROCEDURALNE TEKSTURE
// =========================================================================
function createPixelTexture(drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    drawFn(ctx);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

const texGrassTop = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = Math.random() > 0.4 ? '#4b7a2a' : '#3f6822';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texGrassSide = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = y < 4 + Math.random()*3 ? (Math.random() > 0.4 ? '#4b7a2a' : '#3f6822') : (Math.random() > 0.4 ? '#5c4033' : '#4d3327');
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texDirt = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = Math.random() > 0.4 ? '#5c4033' : '#4d3327';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texStone = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#737373' : '#5c5c5c';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texWood = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = (x % 4 === 0 || Math.random() > 0.8) ? '#3a2212' : '#5c3a21';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texLeaves = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = Math.random() > 0.4 ? '#2e5c1e' : '#224416';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const texWater = createPixelTexture(ctx => {
    ctx.fillStyle = '#1e90ff';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#1c86ee';
    for (let i = 0; i < 5; i++) {
        ctx.fillRect(Math.floor(Math.random()*12), Math.floor(Math.random()*12), 4, 1);
    }
});

const texGlass = createPixelTexture(ctx => {
    ctx.fillStyle = 'rgba(200, 240, 255, 0.2)';
    ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 16, 16);
});

const texBedrock = createPixelTexture(ctx => {
    for (let x=0; x<16; x++) {
        for (let y=0; y<16; y++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#151515' : '#2a2a2a';
            ctx.fillRect(x, y, 1, 1);
        }
    }
});

const materials = {
    grass: [
        new THREE.MeshLambertMaterial({ map: texGrassSide }),
        new THREE.MeshLambertMaterial({ map: texGrassSide }),
        new THREE.MeshLambertMaterial({ map: texGrassTop }),
        new THREE.MeshLambertMaterial({ map: texDirt }),
        new THREE.MeshLambertMaterial({ map: texGrassSide }),
        new THREE.MeshLambertMaterial({ map: texGrassSide })
    ],
    dirt: new THREE.MeshLambertMaterial({ map: texDirt }),
    stone: new THREE.MeshLambertMaterial({ map: texStone }),
    wood: new THREE.MeshLambertMaterial({ map: texWood }),
    leaves: new THREE.MeshLambertMaterial({ map: texLeaves }),
    water: new THREE.MeshLambertMaterial({ map: texWater, transparent: true, opacity: 0.75 }),
    glass: new THREE.MeshLambertMaterial({ map: texGlass, transparent: true, opacity: 0.85 }),
    bedrock: new THREE.MeshLambertMaterial({ map: texBedrock })
};

const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

// =========================================================================
// 4. PROCEDURALNI ŠUM (Seed-ovan) & GENERISANJE TERENA
// =========================================================================
const seedX = Math.random() * 50000;
const seedZ = Math.random() * 50000;

function seededRandom2D(x, z) {
    const sx = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return sx - Math.floor(sx);
}

// Generisanje vijužavih rečnih korita sa kešom
function getRiverValue(x, z) {
    const key = `${x},${z}`;
    if (riverCache.has(key)) return riverCache.get(key);

    const nx = (x + seedX) * 0.005;
    const nz = (z + seedZ) * 0.005;
    const val = Math.sin(nx * 3 + Math.cos(nz * 2)) * 0.5 + Math.cos(nz * 3 + Math.sin(nx * 2)) * 0.5;
    
    riverCache.set(key, val);
    return val;
}

// Osnovna visina kopna
function getBaseHeight(x, z) {
    const nx = x + seedX;
    const nz = z + seedZ;
    // Planine veće
    const mountains = Math.sin(nx * 0.01) * Math.cos(nz * 0.01) * 50; 
    const hills = Math.cos(nx * 0.05) * Math.sin(nz * 0.05) * 10;
    return Math.floor(mountains + hills) + 15; 
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
    if (y >= surfaceHeight - 5) return false; 
    // 3D Šum za pećine
    const d = Math.sin(x * 0.1) * Math.cos(z * 0.1) * Math.sin(y * 0.1);
    return d > 0.4; 
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

function hasBlockAt(bx, by, bz) {
    const key = `${bx},${by},${bz}`;
    if (modifiedBlocks.has(key)) {
        return modifiedBlocks.get(key).action === 'create';
    }
    if (by < WORLD_DEPTH || by > WORLD_HEIGHT) return false;
    if (by <= WORLD_DEPTH + 2) return true; 

    if (isTreeBlockAt(bx, by, bz)) return true;

    const surfaceHeight = getHeight(bx, bz);
    if (by > surfaceHeight) return false; 
    if (isCave(bx, by, bz)) return false; 

    return true;
}

function isBlockExposed(x, y, z) {
    return !hasBlockAt(x+1, y, z) || !hasBlockAt(x-1, y, z) ||
           !hasBlockAt(x, y+1, z) || !hasBlockAt(x, y-1, z) ||
           !hasBlockAt(x, y, z+1) || !hasBlockAt(x, y, z-1);
}

function generateChunk(cx, cz) {
    const chunkKey = `${cx},${cz}`;
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    const blocksByType = { grass: [], dirt: [], stone: [], wood: [], leaves: [], water: [], glass: [], bedrock: [] };

    for (let x = startX; x < startX + CHUNK_SIZE; x++) {
        for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
            const surfaceHeight = getHeight(x, z);

            for (let y = WORLD_DEPTH; y <= Math.max(surfaceHeight, WATER_LEVEL); y++) {
                const blockKey = `${x},${y},${z}`;

                if (modifiedBlocks.has(blockKey)) {
                    const mod = modifiedBlocks.get(blockKey);
                    if (mod.action === 'delete') continue;
                }

                if (y <= surfaceHeight) {
                    if (!hasBlockAt(x, y, z)) continue;
                    if (!isBlockExposed(x, y, z)) continue; 

                    let type = 'stone';
                    if (y <= WORLD_DEPTH + 2) {
                        type = 'bedrock';
                    } else if (y === surfaceHeight) {
                        type = (y < WATER_LEVEL) ? 'dirt' : 'grass';
                    } else if (y > surfaceHeight - 4) {
                        type = 'dirt';
                    }
                    blocksByType[type].push({ x, y, z });

                } else if (y <= WATER_LEVEL) {
                    const isWaterExposed = (y === WATER_LEVEL) || 
                                           !hasBlockAt(x+1, y, z) || !hasBlockAt(x-1, y, z) ||
                                           !hasBlockAt(x, y, z+1) || !hasBlockAt(x, y, z-1);
                    if (isWaterExposed) {
                        blocksByType['water'].push({ x, y, z });
                    }
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

    const chunkGroup = new THREE.Group();
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

    scene.add(chunkGroup);
    loadedChunks.set(chunkKey, chunkGroup);
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

function regenerateChunkAt(bx, bz) {
    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const chunkKey = `${cx},${cz}`;

    const oldGroup = loadedChunks.get(chunkKey);
    if (oldGroup) {
        scene.remove(oldGroup);
        oldGroup.traverse(child => {
            if (child.isInstancedMesh) child.dispose();
        });
        oldGroup.clear();
        loadedChunks.delete(chunkKey);
    }
    generateChunk(cx, cz);
}

let currentChunkX = NaN, currentChunkZ = NaN;
function updateChunks() {
    const pChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
    const pChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);

    if (pChunkX === currentChunkX && pChunkZ === currentChunkZ) return;

    currentChunkX = pChunkX;
    currentChunkZ = pChunkZ;

    const visibleChunks = new Set();

    for (let x = pChunkX - RENDER_DIST; x <= pChunkX + RENDER_DIST; x++) {
        for (let z = pChunkZ - RENDER_DIST; z <= pChunkZ + RENDER_DIST; z++) {
            const chunkKey = `${x},${z}`;
            visibleChunks.add(chunkKey);

            if (!loadedChunks.has(chunkKey)) {
                generateChunk(x, z);
            }
        }
    }

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

    activeGroups.length = 0;
    for (const chunkGroup of loadedChunks.values()) {
        activeGroups.push(chunkGroup);
    }
}

// Spawn iznad tla i vode
camera.position.set(0, getHeight(0, 0) + 3, 0);

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
const keys = { w: false, a: false, s: false, d: false, shift: false };
let vy = 0;
const gravity = -0.0075;
const jumpStrength = 0.14;
let canJump = false;
const playerRadius = 0.3;

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keys.w = true;
    if (e.code === 'KeyA') keys.a = true;
    if (e.code === 'KeyS') keys.s = true;
    if (e.code === 'KeyD') keys.d = true;
    if (e.code === 'ShiftLeft') keys.shift = true;
    
    if (e.code === 'Space' && canJump) {
        vy = jumpStrength;
        canJump = false;
    }
    
    if (e.code === 'KeyK') {
        resetWorld(); // Ovo čisti scenu
        updateChunks(); // Ovo generiše nove čankove samo kada ti želiš
    }
    if (e.code.startsWith('Digit')) {
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
    if (e.code === 'ShiftLeft') keys.shift = false;
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

        if (e.button === 0) { // Levi klik - kopanje
            if (blockType === 'bedrock') return;

            const particleColor = blockColors[blockType] || 0x737373;
            blockParticles.spawn(pos, particleColor, 12);

            modifiedBlocks.set(blockKey, { action: 'delete' });

            // OPTIMIZACIJA: Ažuriraj samo ako je na ivici čanka
            regenerateChunkAt(rx, rz);
            if (rx % CHUNK_SIZE === 0) regenerateChunkAt(rx - 1, rz);
            if (rx % CHUNK_SIZE === CHUNK_SIZE - 1) regenerateChunkAt(rx + 1, rz);
            if (rz % CHUNK_SIZE === 0) regenerateChunkAt(rx, rz - 1);
            if (rz % CHUNK_SIZE === CHUNK_SIZE - 1) regenerateChunkAt(rx, rz + 1);

        } else if (e.button === 2) { // Desni klik - gradnja
            const normal = intersect.face.normal;
            const bx = rx + normal.x;
            const by = ry + normal.y;
            const bz = rz + normal.z;

            const playerFeetY = camera.position.y - 1.6;
            const overlapX = Math.abs(bx - camera.position.x) < 0.6;
            const overlapZ = Math.abs(bz - camera.position.z) < 0.6;
            const overlapY = (by + 0.5 > playerFeetY) && (by - 0.5 < camera.position.y);

            if (!(overlapX && overlapY && overlapZ)) {
                const newKey = `${bx},${by},${bz}`;
                modifiedBlocks.set(newKey, { action: 'create', type: selectedBlock });
                regenerateChunkAt(bx, bz);
            }
        }
    }
});

// Selekcioni okvir
const highlightBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 })
);
scene.add(highlightBox);

// =========================================================================
// 11. MOBILNE KONTROLE I DETEKCIJA DODIRA
// =========================================================================

// Detekcija da li korisnik koristi mobilni telefon
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

if (isMobile) {
    // Prikaži mobilne komande
    document.getElementById('mobile-controls').style.display = 'flex';
    
    // Zaobilazimo PointerLock na mobilnom i ručno aktiviramo igru
    const overlay = document.getElementById('overlay');
    overlay.replaceWith(overlay.cloneNode(true)); // Uklanja stari click listener
    document.getElementById('overlay').addEventListener('click', (e) => {
        document.getElementById('overlay').style.display = 'none';
        controls.isLocked = true; // Varamo engine da pomisli da je miš zaključan kako bi radilo kretanje
    });

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

            if (action === 'mine') {
                if (instMesh.userData.type === 'bedrock') return;

                const particleColor = blockColors[instMesh.userData.type] || 0x737373;
                blockParticles.spawn(pos, particleColor, 12);
                modifiedBlocks.set(blockKey, { action: 'delete' });

                regenerateChunkAt(rx, rz);
                if (rx % CHUNK_SIZE === 0) regenerateChunkAt(rx - 1, rz);
                if (rx % CHUNK_SIZE === CHUNK_SIZE - 1) regenerateChunkAt(rx + 1, rz);
                if (rz % CHUNK_SIZE === 0) regenerateChunkAt(rx, rz - 1);
                if (rz % CHUNK_SIZE === CHUNK_SIZE - 1) regenerateChunkAt(rx, rz + 1);

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
                    regenerateChunkAt(bx, bz);
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
// 10. GAME LOOP (Animacija i fizika)
// =========================================================================
const clock = new THREE.Clock();
let raycastThrottle = 0; 
const tempMatrix = new THREE.Matrix4(); 
const tempPos = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    const deltaTime = Math.min(clock.getDelta(), 0.1);
    blockParticles.update(deltaTime);

    if (controls.isLocked) {
        const oldX = camera.position.x;
        const oldZ = camera.position.z;

        const moveSpeed = keys.shift ? 0.17 : 0.1;

        if (keys.w) controls.moveForward(moveSpeed);
        if (keys.s) controls.moveForward(-moveSpeed);
        if (keys.a) controls.moveRight(-moveSpeed);
        if (keys.d) controls.moveRight(moveSpeed);

        const dx = camera.position.x - oldX;
        const dz = camera.position.z - oldZ;

        camera.position.x = oldX;
        camera.position.z = oldZ;

        const pChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
        const pChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
        const chunkKey = `${pChunkX},${pChunkZ}`;

        if (loadedChunks.has(chunkKey)) {
            vy += gravity;
        } else {
            vy = 0; 
        }

        movePlayer(dx, vy, dz);

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