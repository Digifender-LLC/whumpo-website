import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath,URL} from 'node:url';
export default defineConfig({root:'frontend',plugins:[react(),tailwindcss()],resolve:{alias:{'@':fileURLToPath(new URL('./frontend/src',import.meta.url))}},build:{manifest:true,outDir:'../dist',emptyOutDir:true},server:{host:'127.0.0.1',proxy:{'/api':'http://localhost:8793','/contact':'http://localhost:8793'}}});
