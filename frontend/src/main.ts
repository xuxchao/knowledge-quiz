import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '@unocss/reset/tailwind.css';
import 'uno.css';
import type { Component } from 'vue';
import App from './App.vue';

const app = createApp(App as Component);
const pinia = createPinia();

app.use(pinia);
app.mount('#app');
