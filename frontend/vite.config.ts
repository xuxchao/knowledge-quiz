import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from '@unocss/vite';

export default defineConfig({
  // 指定 .env 文件所在目录为项目根目录（而非 frontend/）
  envDir: '../',
  plugins: [vue(), UnoCSS()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
