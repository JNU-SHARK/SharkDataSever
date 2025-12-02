export default {
    props: ['currentTab'],
    emits: ['update:currentTab'],
    template: `
    <nav style="background: white; padding: 10px 20px; margin-bottom: 20px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; gap: 10px;">
        <button 
            v-for="tab in tabs" 
            :key="tab.id"
            @click="$emit('update:currentTab', tab.id)"
            :style="{
                padding: '8px 16px',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontWeight: 'bold',
                background: currentTab === tab.id ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
                color: currentTab === tab.id ? 'white' : '#666',
                transition: 'all 0.3s'
            }"
        >
            {{ tab.name }}
        </button>
    </nav>
    `,
    setup() {
        const tabs = [
            { id: 'console', name: '📡 MQTT 控制台' },
            { id: 'custom-config', name: '🛠️ 自定义数据配置' }
        ];
        return { tabs };
    }
};
