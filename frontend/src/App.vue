<script setup lang="ts">
import { ref } from 'vue';
import { MessageSquare, Database } from 'lucide-vue-next';
import AiConversationPage from './pages/AiConversationPage.vue';
import BackendManagementPage from './pages/BackendManagementPage.vue';

type PageType = 'conversation' | 'backend';

const currentPage = ref<PageType>('conversation');

const switchPage = (page: PageType) => {
  currentPage.value = page;
};
</script>

<template>
  <div class="min-h-screen bg-gray-50">
    <header class="bg-white border-b border-gray-200 shadow-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <MessageSquare class="w-5 h-5 text-white" />
            </div>
            <h1 class="text-xl font-bold text-gray-900">知识文档系统</h1>
          </div>
          <nav class="flex space-x-1">
            <button
              :class="[
                'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
                currentPage === 'conversation'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100',
              ]"
              @click="switchPage('conversation')"
            >
              <MessageSquare class="w-4 h-4" />
              <span>AI 会话</span>
            </button>
            <button
              :class="[
                'flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors',
                currentPage === 'backend'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100',
              ]"
              @click="switchPage('backend')"
            >
              <Database class="w-4 h-4" />
              <span>数据管理</span>
            </button>
          </nav>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <AiConversationPage v-if="currentPage === 'conversation'" />
      <BackendManagementPage v-else />
    </main>
  </div>
</template>
