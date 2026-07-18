FROM docker.elastic.co/elasticsearch/elasticsearch:8.15.3

# 预装 IK 中文分词器
# 版本必须与 ES 版本严格一致，否则插件加载会失败导致节点无法启动
# 发布地址：https://release.infinilabs.com/analysis-ik/stable
RUN elasticsearch-plugin install --batch https://release.infinilabs.com/analysis-ik/stable/elasticsearch-analysis-ik-8.15.3.zip

# 挂载 IK 自定义词典和配置
# IKAnalyzer.cfg.xml 引用 custom.dic，ES 启动时 IK 会自动加载
COPY docker/elasticsearch/custom.dic /usr/share/elasticsearch/config/analysis-ik/custom.dic
COPY docker/elasticsearch/IKAnalyzer.cfg.xml /usr/share/elasticsearch/config/analysis-ik/IKAnalyzer.cfg.xml
