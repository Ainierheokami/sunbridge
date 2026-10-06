(function () {
  const STORAGE_KEY = 'sunbridge.locale';
  const SUPPORTED = ['zh-CN', 'en-US'];
  const messages = {
    'zh-CN': {
      'nav.workspace': '工作区', 'nav.overview': '概览', 'nav.hosts': '主机', 'nav.network': '网络路径', 'nav.preferences': '偏好设置', 'nav.settings': '设置', 'nav.addHost': '添加主机',
      'brand.subtitle': '网页客户端 / 0.2', 'topbar.local': '本地 /', 'topbar.desktop': 'SUNBRIDGE 控制台', 'bridge.online': '桥接在线', 'bridge.offline': '桥接离线', 'bridge.ready': '桥接服务就绪', 'bridge.initializing': '等待桥接', 'bridge.initializingMeta': '正在连接本地服务…', 'bridge.unavailable': '桥接服务不可用', 'bridge.liveMeta': '真实 Sunshine 控制面', 'bridge.demoMeta': '演示模式 · 不发送网络请求', 'bridge.startHint': '运行 start.bat / start.sh 后刷新页面',
      'profile.name': 'SUNBRIDGE', 'profile.local': '本地配置', 'eyebrow.private': '私有串流控制台', 'build.preview': '构建 0.2 预览', 'overview.titleA': '串流你的', 'overview.titleB': '整个游戏库。', 'overview.copyA': '为你的设备准备的安静、低延迟客户端。', 'overview.copyB': '只需配对一次，选个游戏，保持专注。', 'overview.lastSession': '上次会话', 'overview.yesterday': '昨天', 'overview.ready': '准备串流', 'overview.pairedHost': '已配对主机', 'overview.primaryRig': '你的主力设备', 'overview.targetOutput': '目标输出', 'overview.frames': '帧 / 秒', 'overview.estimatedPing': '预计延迟', 'action.connectHost': '连接主机', 'action.hostDetails': '主机详情', 'action.inspectPath': '查看网络路径', 'signal.health': '信号健康度', 'signal.cleanPath': '路径稳定', 'signal.latency': '延迟', 'signal.last60': '最近 60 秒', 'signal.jitter': '抖动', 'signal.loss': '丢包', 'signal.route': '路径', 'library.recent': '最近游玩', 'library.title': '游戏库', 'library.synced': '{count} 个标题已同步', 'library.lastPlayed': '上次游玩 {time}', 'library.thisWeek': '本周 {time}', 'library.fullControl': '完整控制 · 就绪', 'activity.log': '会话日志', 'activity.recent': '最近活动', 'activity.clear': '清除', 'activity.empty': '暂无活动。下一次串流会话会显示在这里。', 'protocol.compatibility': 'Sunshine 兼容性', 'protocol.path': '协议路径', 'protocol.live': '真实控制面', 'protocol.demo': '演示模式', 'protocol.browser': '浏览器', 'protocol.uiControls': '界面 + 控制', 'protocol.bridge': '桥接', 'protocol.localApi': '本地 API', 'protocol.sunshine': 'Sunshine', 'protocol.gameStream': 'GameStream 主机', 'protocol.noteLive': '浏览器通过本地 Bridge 访问 Sunshine 控制面；视频、音频和低延迟输入仍需 WebRTC 或原生媒体网关。', 'protocol.noteDemo': '当前为演示模式，不会连接 Sunshine。启动本地 Bridge 后刷新页面即可切换到真实控制面。', 'protocol.viewPorts': '查看端口表',
      'hosts.eyebrow': '主机目录', 'hosts.title': '你的主机。', 'hosts.copy': '配对一次，就能直接从浏览器启动会话。', 'host.online': '在线', 'host.sleeping': '睡眠中', 'host.paired': '已配对', 'host.lan': '局域网主机', 'host.lastSeenNow': '刚刚看到', 'host.lastSeen': '上次在线 {time}', 'host.connect': '连接', 'host.wake': '唤醒主机', 'host.wol': '已启用 Wake-on-LAN', 'host.refresh': '刷新信息', 'host.noHosts': '还没有保存的主机。', 'host.refreshApps': '刷新应用列表',
      'network.eyebrow': '网络路径', 'network.title': '从浏览器到主机。', 'network.copy': '先把控制面做真实，再把媒体通道接入 WebRTC 或原生 Helper。', 'network.diagnostic': '运行诊断', 'network.idle': '待机', 'network.running': '运行中', 'network.healthy': '健康', 'network.demo': '演示模式', 'network.portMap': 'Sunshine 端口表', 'network.copyPorts': '复制端口', 'network.diagnosticLog': '诊断日志', 'network.browserLayer': '浏览器层', 'network.webUi': 'Web 界面', 'network.service': '服务', 'network.port': '端口', 'network.transport': '传输', 'network.state': '状态', 'network.bridgeLayer': '本地 Bridge', 'network.sunshineLayer': 'Sunshine 主机',
      'settings.eyebrow': '控制设置', 'settings.title': '让每一帧都可控。', 'settings.copy': '这些选项会进入后续的真实串流协商。', 'settings.video': '视频', 'settings.session': '会话行为', 'settings.resolution': '分辨率', 'settings.resolutionHint': '首选串流画布', 'settings.frameRate': '帧率', 'settings.frameRateHint': '保持局域网运动流畅', 'settings.codec': '视频编码', 'settings.codecHint': '由 Bridge 协商', 'settings.matchDisplay': '匹配主机显示器', 'settings.matchDisplayHint': '使用主机当前刷新模式', 'settings.inputUi': '输入与界面', 'settings.capturePointer': '捕获指针', 'settings.capturePointerHint': '串流开始时锁定指针', 'settings.telemetry': '显示遥测', 'settings.telemetryHint': '显示 FPS、延迟和码率', 'settings.askLaunch': '启动前确认', 'settings.askLaunchHint': '每次新会话前确认', 'settings.reduceMotion': '减少动画', 'settings.reduceMotionHint': '使用更稳定的界面过渡', 'settings.footnote': '这些控制项属于展示层；真实传输适配器应自行保存编码器、解码器和输入能力。',
      'pair.newHost': '新主机', 'pair.title': '让主机上线。', 'pair.copy': '输入局域网中的 Sunshine 主机地址。配对信息只保存在本机。', 'pair.discover': '发现', 'pair.pair': '配对', 'pair.sync': '同步', 'pair.address': '主机地址', 'pair.displayName': '显示名称', 'pair.pin': '配对 PIN', 'pair.note': '浏览器会把证书交换交给本地 Bridge。私钥不会返回到页面。', 'pair.submit': '配对此主机', 'pair.close': '关闭对话框', 'pair.opening': '连接 Sunshine…', 'pair.checking': '正在检查 Sunshine 主机', 'pair.certificate': '请求配对证书…', 'pair.certificateDetail': '正在发送客户端身份并完成挑战响应', 'pair.syncing': '同步应用库…', 'pair.syncDetail': '正在读取主机应用列表', 'pair.done': '主机已配对', 'pair.doneDetail': '{name} 已准备好开始会话', 'pair.waiting': '等待 Bridge 响应', 'pair.failed': '配对失败', 'pair.validation': '请输入主机地址、名称和 4 位 PIN。',
      'session.live': '会话已启动', 'session.controlStarted': '{app} 的 Sunshine 控制面已启动。', 'session.mediaPending': '视频 / 音频媒体通道尚未接入浏览器。', 'session.couldNotStart': '无法启动会话', 'session.ended': '会话已结束', 'session.disconnected': '{app} 已断开。', 'session.negotiating': '正在协商控制面…', 'session.controlPlane': '控制面 / 已启动', 'session.mediaPlane': '媒体通道 / 待接入', 'session.inputPlane': '输入 / 待接入', 'session.session': '会话', 'session.end': '结束会话', 'session.pointerHint': '点击画面捕获鼠标 · Ctrl+Alt+Shift+Z 释放鼠标 · Ctrl+Alt+Shift+Q 结束会话', 'session.notStreaming': '已连接 Sunshine 控制面，但浏览器视频通道尚未接入',
      'diagnostic.running': '正在运行诊断', 'diagnostic.copy': '正在检查 Bridge、主机可达性和控制面路径。', 'diagnostic.clean': '路径正常', 'diagnostic.result': '{latency} 往返 · {jitter} 抖动 · {loss} 丢包', 'diagnostic.failed': '诊断失败', 'diagnostic.demo': '演示诊断', 'diagnostic.demoDetail': '演示模式不会探测真实主机、控制端口或 RTSP。',
      'toast.hostDetails': '主机详情', 'toast.certFingerprint': '已保存配对证书指纹：{fingerprint}', 'toast.activityCleared': '活动已清除', 'toast.activityReady': '会话日志已准备好记录下一次串流。', 'toast.waking': '正在唤醒主机', 'toast.wakingDetail': '已向 {name} 发送 Wake-on-LAN 请求。', 'toast.wakeSent': '已发送唤醒请求', 'toast.wakeSentDetail': '请确认交换机允许广播到该主机。', 'toast.wakeFailed': '唤醒失败', 'toast.portsCopied': '端口表已复制', 'toast.clipboardUnavailable': '当前环境不允许访问剪贴板。', 'toast.bridgeOffline': '本地 Bridge 不在线', 'toast.bridgeOfflineDetail': '真实模式不会伪装成在线；请先运行 start.bat / start.sh。',
      'common.online': '在线', 'common.offline': '离线', 'common.unknown': '未知', 'error.bridgeUnavailable': '无法连接本地 Bridge，请确认 Sunbridge 已经启动（start.bat / start.sh）。', 'error.requestTimeout': '请求 Sunshine 超时，请检查主机地址和网络。', 'error.pairRequired': '请先完成主机配对。', 'error.noHost': '请先添加或选择一台 Sunshine 主机。', 'error.invalidAddress': 'Sunshine 主机地址无效。', 'error.invalidPort': 'Sunshine 端口必须是 1 到 65535。', 'error.invalidPin': '配对 PIN 必须是 4 位数字。', 'error.notPaired': '请先完成主机配对。', 'error.appsUnavailable': '无法读取 Sunshine 应用列表。', 'error.sunshineUnavailable': '无法读取 Sunshine 主机信息。', 'error.wakeMac': 'Wake-on-LAN 需要有效的 MAC 地址。', 'error.rtspUnsupported': 'Sunshine 返回了加密 RTSP；当前媒体网关尚未接入。', 'error.bridgeRequestTimeout': '本地 Bridge 请求超时，请稍后重试。', 'error.sessionEventsUnsupported': '当前浏览器不支持实时会话事件。', 'error.sessionEventsDisconnected': '会话事件流已断开，正在自动重连。', 'error.connectionFailed': '无法连接 Sunshine 主机，请检查地址、端口和网络。', 'error.certificateMismatch': 'Sunshine TLS 证书与已保存的配对证书不一致。', 'error.pairFailed': 'Sunshine 配对未完成，请检查 PIN 并重试。', 'error.sunshineRequestFailed': 'Sunshine 未能完成此请求，请检查主机状态和会话。', 'common.now': '现在', 'common.none': '无', 'common.pending': '待定', 'common.unknownGpu': '未知 GPU', 'common.sunshine': 'Sunshine', 'common.desktop': '桌面', 'common.local': '局域网', 'common.remote': '远程', 'common.ms': '毫秒', 'common.mbps': 'Mbps', 'common.live': 'LIVE', 'common.video': '视频', 'common.audio': '音频', 'common.fps': 'FPS', 'common.bitrate': '码率', 'common.input': '输入', 'common.hevc': 'HEVC', 'common.opus': 'OPUS', 'common.ready': '就绪', 'common.bridge': 'Bridge', 'common.real': '真实', 'common.demo': '演示',
      'drawer.quick': '快速设置', 'drawer.defaults': '会话默认值', 'drawer.quality': '画质', 'drawer.hdr': 'HDR', 'drawer.pointer': '指针捕获', 'drawer.stats': '屏幕统计', 'drawer.openAll': '打开全部设置', 'drawer.ready': 'Bridge 已就绪', 'drawer.responds': '本地适配器响应 {latency}',
      'language.label': '语言', 'language.zh': '简体中文', 'language.en': 'English', 'language.changed': '语言已切换', 'language.changedDetail': '界面语言已更新。',
      'app.modeLive': '真实模式', 'app.modeDemo': '演示模式', 'app.statusChecking': '检查中…', 'app.statusUnknown': '状态未知', 'app.localOnly': '仅本机可见',
      'action.addHost': '添加主机', 'common.sunshineHost': 'Sunshine 主机', 'diagnostic.noHost': '请先添加或选择一台 Sunshine 主机。', 'diagnostic.waiting': '等待诊断结果', 'diagnostic.controlPort': '控制端口', 'diagnostic.rtspPort': 'RTSP 端口', 'diagnostic.reachable': '可达', 'diagnostic.unreachable': '不可达', 'host.noHostsHint': '添加主机地址后，Bridge 会从 Sunshine 读取真实信息。', 'host.offlineHint': '主机当前不可达；请先刷新状态或唤醒主机。', 'host.refreshDone': '主机信息已刷新', 'host.refreshFailed': '刷新主机失败', 'host.unpaired': '未配对', 'library.available': '可启动', 'library.empty': '还没有同步的应用。', 'library.emptyHint': '先配对主机，然后刷新应用列表。', 'library.play': '启动 {name}', 'network.available': '可达', 'network.certificate': '已保存证书', 'network.controlPort': '控制端口', 'network.rtspPort': 'RTSP 端口', 'network.controlOnly': '仅控制面', 'network.degraded': '路径受损', 'network.excellent': '优秀', 'network.linkQuality': '链路质量', 'network.notProbed': '尚未探测', 'network.paired': '已配对', 'network.pairing': '配对状态', 'network.waiting': '等待检测', 'overview.noHost': '暂无已保存主机', 'overview.noHostMeta': '添加 Sunshine 主机后，这里会显示状态。', 'overview.noHostStatus': '等待主机', 'overview.noSessionMeta': '还没有已记录的串流会话', 'session.stopFailed': '结束会话失败', 'settings.autosaved': '设置会自动保存', 'settings.disabled': '已关闭', 'settings.enabled': '已开启', 'settings.outputDefaults': '输出默认值', 'settings.updated': '设置已更新', 'signal.degradedPath': '路径有丢包', 'signal.waiting': '等待诊断', 'toast.portsCopiedDetail': 'Sunshine 控制面和媒体端口已复制。',
      'meta.title': 'Sunbridge / 网页客户端', 'meta.description': 'Sunbridge：在浏览器里串流 Sunshine 主机的画面、声音和控制。',
      'aria.navigation': '主导航', 'aria.connectionDiagnostic': '运行连接诊断', 'aria.profileSettings': '打开配置设置', 'aria.quickSettings': '快速设置', 'aria.closeSettings': '关闭设置', 'aria.sessionSettings': '会话设置', 'aria.signalChart': '网络信号历史图', 'aria.stableLatency': '稳定延迟曲线', 'aria.hostDetails': '主机详情', 'aria.addHost': '添加主机', 'aria.language': '界面语言', 'aria.pairModal': '配对 Sunshine 主机', 'aria.closePair': '关闭配对对话框', 'aria.streamOverlay': '串流会话状态', 'aria.endSession': '结束会话',
      'aria.bridgeStatus': '本地 Sunbridge 服务状态',
      'network.roundTrip': '往返延迟', 'network.stable': '稳定', 'network.trusted': '可信', 'network.certificateShort': '证书', 'network.requestSession': '请求 / 会话', 'network.browserToBridgeHost': '浏览器 → Bridge → 主机', 'network.webClient': 'Sunbridge 网页端', 'network.httpsUi': 'HTTPS / 界面', 'network.localBridge': '本地 Bridge', 'network.websocketDecode': 'WebSocket + 解码', 'network.transportObservatory': '传输观测台', 'network.sunshineDefaults': 'Sunshine 默认值', 'network.liveDiagnostic': '实时诊断',
      'settings.clientPreferences': '客户端偏好', 'settings.makeItYours': '按你的方式设置。', 'settings.smallControls': '用少量控制项打造更安静的串流会话。', 'settings.streamProfile': '串流配置', 'settings.autosavedLabel': '自动保存',
      'pair.addressPlaceholder': '192.168.1.42 或主机名', 'pair.namePlaceholder': '我的游戏主机', 'pair.pinPlaceholder': '4 位 PIN',
      'drawer.qualityBalanced': '均衡 · 1080p60', 'drawer.qualitySharp': '清晰 · 1440p60', 'drawer.qualityUltra': '极致 · 4K60',
      'session.controlStarting': '控制面 / 启动中', 'session.rtspPrefix': 'RTSP', 'session.rtspProbing': 'RTSP / 探测中', 'session.rtspConnected': 'RTSP / 已连接', 'session.rtspFailed': 'RTSP / 失败', 'session.rtspUnsupported': 'RTSP / 不支持', 'session.rtspDemo': 'RTSP / 演示', 'session.rtspUnknown': 'RTSP / 未知', 'session.rtspDetail': '正在探测 RTSP OPTIONS 和 DESCRIBE…', 'session.rtspConnectedDetail': 'RTSP 已响应；浏览器媒体通道尚未接入。', 'session.rtspFailedDetail': 'RTSP 探测失败；请检查 RTSP 端口和 Sunshine 会话。', 'session.rtspUnsupportedDetail': 'Sunshine 返回加密 RTSP；当前 Bridge 未实现解密媒体通道。', 'session.mediaPrefix': 'MEDIA', 'session.mediaNotConnected': 'MEDIA / 未连接', 'session.mediaConnected': 'MEDIA / 已连接', 'session.mediaDemo': 'MEDIA / 演示', 'session.mediaUnknown': 'MEDIA / 未知', 'session.mediaConnectedDetail': '媒体通道已报告连接，但浏览器解码器尚未接入。', 'session.rtspNegotiated': 'RTSP / 已协商', 'session.rtspNegotiatedDetail': 'RTSP 已完成 OPTIONS、DESCRIBE、SETUP、ANNOUNCE 和 PLAY。', 'session.mediaWaiting': 'MEDIA / 等待数据', 'session.mediaWaitingDetail': 'RTSP 已协商；正在等待 Sunshine 的 UDP 媒体包。', 'session.mediaFirstPacket': '已收到媒体首包', 'session.browserDecoderPending': '已收到 RTP 媒体；浏览器解码器尚未接入。', 'session.videoPackets': '视频包', 'session.audioPackets': '音频包', 'session.receivingBitrate': '接收码率', 'session.negotiationTime': '协商耗时', 'session.firstPacket': '首包时间', 'session.lastPacket': '最近包', 'session.packetCount': '总包数', 'session.mediaBytes': '媒体字节', 'session.videoBytes': '视频字节', 'session.audioBytes': '音频字节', 'session.mediaState': '媒体状态', 'session.inputPrefix': 'INPUT', 'session.inputNotConnected': 'INPUT / 未连接', 'session.inputConnected': 'INPUT / 已连接', 'aria.logout': '退出登录', 'session.inputConnecting': 'INPUT / 连接中', 'session.inputFailed': 'INPUT / 失败', 'session.inputCaptured': 'INPUT / 已捕获鼠标', 'session.hostTerminated': 'Sunshine 主机结束了串流会话。', 'session.inputDemo': 'INPUT / 演示', 'session.inputUnknown': 'INPUT / 未知', 'session.demoDetail': '演示会话只展示状态，不会连接 Sunshine 媒体。',
      'error.code.INVALID_ADDRESS': 'Sunshine 地址无效', 'error.code.INVALID_PORT': 'Sunshine 端口无效', 'error.code.INVALID_PIN': 'PIN 不正确或配对失败', 'error.code.NOT_PAIRED': '请先完成主机配对', 'error.code.SUNSHINE_UNAVAILABLE': '无法连接 Sunshine 主机', 'error.code.SUNSHINE_REQUEST_FAILED': 'Sunshine 请求失败', 'error.code.RTSP_NEGOTIATION_FAILED': 'RTSP 媒体协商失败', 'error.code.RTSP_ENCRYPTED_UNSUPPORTED': '当前不支持加密 RTSP 媒体', 'error.code.MEDIA_NOT_CONNECTED': '媒体通道未连接', 'error.code.INPUT_NOT_CONNECTED': '输入通道未连接', 'error.code.TLS_CERTIFICATE_MISMATCH': 'Sunshine TLS 证书与已配对证书不一致', 'error.code.HOST_NOT_FOUND': '找不到 Sunshine 主机', 'error.code.WAKE_MAC_REQUIRED': '唤醒主机需要 MAC 地址', 'error.code.BRIDGE_ERROR': '本地 Bridge 请求失败',
      'common.ok': '确定',

    },
    'en-US': {
      'nav.workspace': 'WORKSPACE', 'nav.overview': 'Overview', 'nav.hosts': 'Hosts', 'nav.network': 'Network path', 'nav.preferences': 'PREFERENCES', 'nav.settings': 'Settings', 'nav.addHost': 'Add a host',
      'brand.subtitle': 'WEB CLIENT / 0.2', 'topbar.local': 'LOCAL /', 'topbar.desktop': 'SUNBRIDGE CONSOLE', 'bridge.online': 'Bridge online', 'bridge.offline': 'Bridge offline', 'bridge.ready': 'Bridge ready', 'bridge.initializing': 'Bridge starting', 'bridge.initializingMeta': 'Connecting to the local service…', 'bridge.unavailable': 'Bridge unavailable', 'bridge.liveMeta': 'Live Sunshine control plane', 'bridge.demoMeta': 'Demo mode · no network requests', 'bridge.startHint': 'Run start.bat / start.sh, then refresh',
      'profile.name': 'SUNBRIDGE', 'profile.local': 'Local profile', 'eyebrow.private': 'PRIVATE STREAMING CONSOLE', 'build.preview': 'BUILD 0.2 PREVIEW', 'overview.titleA': 'Stream your', 'overview.titleB': 'whole library.', 'overview.copyA': 'A quiet, low-latency client for your own machines.', 'overview.copyB': 'Pair once. Pick a game. Stay in the flow.', 'overview.lastSession': 'LAST SESSION', 'overview.yesterday': 'Yesterday', 'overview.ready': 'READY TO STREAM', 'overview.pairedHost': 'PAIRED HOST', 'overview.primaryRig': 'YOUR PRIMARY RIG', 'overview.targetOutput': 'target output', 'overview.frames': 'frames / sec', 'overview.estimatedPing': 'estimated ping', 'action.connectHost': 'Connect to host', 'action.hostDetails': 'Host details', 'action.inspectPath': 'Inspect network path', 'signal.health': 'SIGNAL HEALTH', 'signal.cleanPath': 'Clean path', 'signal.latency': 'latency', 'signal.last60': 'last 60 sec', 'signal.jitter': 'JITTER', 'signal.loss': 'LOSS', 'signal.route': 'ROUTE', 'library.recent': 'RECENTLY PLAYED', 'library.title': 'Library', 'library.synced': '{count} titles synced', 'library.lastPlayed': 'Last played {time}', 'library.thisWeek': '{time} this week', 'library.fullControl': 'Full control · ready', 'activity.log': 'SESSION LOG', 'activity.recent': 'Recent activity', 'activity.clear': 'Clear', 'activity.empty': 'No activity yet. Your next session will appear here.', 'protocol.compatibility': 'SUNSHINE COMPATIBILITY', 'protocol.path': 'Protocol path', 'protocol.live': 'LIVE CONTROL PLANE', 'protocol.demo': 'DEMO MODE', 'protocol.browser': 'Browser', 'protocol.uiControls': 'UI + controls', 'protocol.bridge': 'Bridge', 'protocol.localApi': 'Local API', 'protocol.sunshine': 'Sunshine', 'protocol.gameStream': 'GameStream host', 'protocol.noteLive': 'The browser reaches Sunshine control endpoints through the local Bridge; video, audio and low-latency input still need a WebRTC or native media gateway.', 'protocol.noteDemo': 'Demo mode is active and will not contact Sunshine. Start the local Bridge and refresh to use live control endpoints.', 'protocol.viewPorts': 'View port map',
      'hosts.eyebrow': 'HOST DIRECTORY', 'hosts.title': 'Your hosts.', 'hosts.copy': 'Pair once, then launch a session without leaving the browser.', 'host.online': 'Online', 'host.sleeping': 'Sleeping', 'host.paired': 'Paired', 'host.lan': 'LAN host', 'host.lastSeenNow': 'Last seen now', 'host.lastSeen': 'Last seen {time}', 'host.connect': 'Connect', 'host.wake': 'Wake host', 'host.wol': 'Wake-on-LAN enabled', 'host.refresh': 'Refresh info', 'host.noHosts': 'No saved hosts yet.', 'host.refreshApps': 'Refresh app list',
      'network.eyebrow': 'NETWORK PATH', 'network.title': 'From browser to host.', 'network.copy': 'Make the control plane real first, then attach the media path through WebRTC or a native helper.', 'network.diagnostic': 'Run diagnostic', 'network.idle': 'idle', 'network.running': 'running', 'network.healthy': 'healthy', 'network.demo': 'demo mode', 'network.portMap': 'Sunshine port map', 'network.copyPorts': 'Copy ports', 'network.diagnosticLog': 'Diagnostic log', 'network.browserLayer': 'Browser layer', 'network.webUi': 'Web UI', 'network.service': 'service', 'network.port': 'port', 'network.transport': 'transport', 'network.state': 'state', 'network.bridgeLayer': 'Local Bridge', 'network.sunshineLayer': 'Sunshine host',
      'settings.eyebrow': 'CONTROL SETTINGS', 'settings.title': 'Make every frame yours.', 'settings.copy': 'These choices feed the real stream negotiation that comes next.', 'settings.video': 'VIDEO', 'settings.session': 'Session behavior', 'settings.resolution': 'Resolution', 'settings.resolutionHint': 'Preferred stream canvas', 'settings.frameRate': 'Frame rate', 'settings.frameRateHint': 'Keep motion smooth on LAN', 'settings.codec': 'Video codec', 'settings.codecHint': 'Negotiated with bridge', 'settings.matchDisplay': 'Match host display', 'settings.matchDisplayHint': "Use the host's active refresh mode", 'settings.inputUi': 'INPUT & UI', 'settings.capturePointer': 'Capture pointer', 'settings.capturePointerHint': 'Lock pointer when stream begins', 'settings.telemetry': 'Show telemetry', 'settings.telemetryHint': 'FPS, latency and bitrate overlay', 'settings.askLaunch': 'Ask before launch', 'settings.askLaunchHint': 'Confirm every new session', 'settings.reduceMotion': 'Reduce motion', 'settings.reduceMotionHint': 'Prefer steadier interface transitions', 'settings.footnote': 'These controls belong to the presentation layer. The real transport adapter should persist its own encoder, decoder and input capabilities.',
      'pair.newHost': 'NEW HOST', 'pair.title': 'Bring a host online.', 'pair.copy': 'Use the Sunshine host address on your local network. Pairing stays on this device.', 'pair.discover': 'discover', 'pair.pair': 'pair', 'pair.sync': 'sync', 'pair.address': 'Host address', 'pair.displayName': 'Display name', 'pair.pin': 'Pairing PIN', 'pair.note': 'The browser hands the certificate exchange to the local Bridge. The private key never returns to the page.', 'pair.submit': 'Pair this host', 'pair.close': 'Close dialog', 'pair.opening': 'Connecting to Sunshine…', 'pair.checking': 'Checking Sunshine host', 'pair.certificate': 'Requesting pairing certificate…', 'pair.certificateDetail': 'Sending the client identity and completing the challenge', 'pair.syncing': 'Syncing app library…', 'pair.syncDetail': 'Reading the host application catalog', 'pair.done': 'Host paired', 'pair.doneDetail': '{name} is ready for a session', 'pair.waiting': 'Waiting for a Bridge response', 'pair.failed': 'Pairing failed', 'pair.validation': 'Enter a host address, display name, and four digit PIN.',
      'session.live': 'Session control plane started', 'session.controlStarted': '{app} is running on Sunshine control endpoints.', 'session.mediaPending': 'Video / audio media transport is not connected to the browser yet.', 'session.couldNotStart': 'Could not start session', 'session.ended': 'Session ended', 'session.disconnected': '{app} has been disconnected.', 'session.negotiating': 'Negotiating control plane…', 'session.controlPlane': 'CONTROL / STARTED', 'session.mediaPlane': 'MEDIA / NOT CONNECTED', 'session.inputPlane': 'INPUT / NOT CONNECTED', 'session.session': 'session', 'session.end': 'End session', 'session.pointerHint': 'Click the stream to capture the mouse · Ctrl+Alt+Shift+Z releases it · Ctrl+Alt+Shift+Q ends the session', 'session.notStreaming': 'Sunshine control plane is connected, but browser video transport is not connected yet',
      'diagnostic.running': 'Running diagnostic', 'diagnostic.copy': 'Checking the Bridge, host reachability and control-plane route.', 'diagnostic.clean': 'Path is clean', 'diagnostic.result': '{latency} round trip · {jitter} jitter · {loss} loss', 'diagnostic.failed': 'Diagnostic failed', 'diagnostic.demo': 'Demo diagnostic', 'diagnostic.demoDetail': 'Demo mode does not probe a real host, control port, or RTSP endpoint.',
      'toast.hostDetails': 'Host details', 'toast.certFingerprint': 'Paired certificate fingerprint: {fingerprint}', 'toast.activityCleared': 'Activity cleared', 'toast.activityReady': 'The session log is ready for your next stream.', 'toast.waking': 'Waking host', 'toast.wakingDetail': '{name} is receiving a Wake-on-LAN request.', 'toast.wakeSent': 'Wake request sent', 'toast.wakeSentDetail': 'Make sure your switch allows broadcast to this host.', 'toast.wakeFailed': 'Wake failed', 'toast.portsCopied': 'Port map copied', 'toast.clipboardUnavailable': 'Clipboard access is unavailable in this environment.', 'toast.bridgeOffline': 'Local Bridge is offline', 'toast.bridgeOfflineDetail': 'Live mode never pretends to be online; run start.bat / start.sh first.',
      'common.online': 'Online', 'common.offline': 'Offline', 'common.unknown': 'Unknown', 'error.bridgeUnavailable': 'The local Bridge is unavailable. Start Sunbridge (start.bat / start.sh) and try again.', 'error.requestTimeout': 'The Sunshine request timed out. Check the host address and network.', 'error.pairRequired': 'Pair the host before continuing.', 'error.noHost': 'Add or select a Sunshine host first.', 'error.invalidAddress': 'The Sunshine host address is invalid.', 'error.invalidPort': 'The Sunshine port must be between 1 and 65535.', 'error.invalidPin': 'The pairing PIN must contain four digits.', 'error.notPaired': 'Pair the host before continuing.', 'error.appsUnavailable': 'Could not read the Sunshine application list.', 'error.sunshineUnavailable': 'Could not read Sunshine host information.', 'error.wakeMac': 'Wake-on-LAN requires a valid MAC address.', 'error.rtspUnsupported': 'Sunshine returned encrypted RTSP; the media gateway is not connected yet.', 'error.bridgeRequestTimeout': 'The local Bridge request timed out. Please try again.', 'error.sessionEventsUnsupported': 'This browser does not support live session events.', 'error.sessionEventsDisconnected': 'The live session event stream disconnected; reconnecting.', 'error.connectionFailed': 'Could not connect to the Sunshine host. Check its address, port, and network.', 'error.certificateMismatch': 'The Sunshine TLS certificate does not match the saved pairing certificate.', 'error.pairFailed': 'Sunshine pairing did not complete. Check the PIN and try again.', 'error.sunshineRequestFailed': 'Sunshine could not complete the request. Check the host and session state.', 'common.now': 'now', 'common.none': 'none', 'common.pending': 'pending', 'common.unknownGpu': 'Unknown GPU', 'common.sunshine': 'Sunshine', 'common.desktop': 'Desktop', 'common.local': 'LAN', 'common.remote': 'Remote', 'common.ms': 'ms', 'common.mbps': 'Mbps', 'common.live': 'LIVE', 'common.video': 'VIDEO', 'common.audio': 'AUDIO', 'common.fps': 'FPS', 'common.bitrate': 'BITRATE', 'common.input': 'INPUT', 'common.hevc': 'HEVC', 'common.opus': 'OPUS', 'common.ready': 'READY', 'common.bridge': 'Bridge', 'common.real': 'LIVE', 'common.demo': 'DEMO',
      'drawer.quick': 'QUICK SETTINGS', 'drawer.defaults': 'Session defaults', 'drawer.quality': 'Quality', 'drawer.hdr': 'HDR', 'drawer.pointer': 'Pointer capture', 'drawer.stats': 'On-screen stats', 'drawer.openAll': 'Open all settings', 'drawer.ready': 'Bridge is ready', 'drawer.responds': 'Local adapter responds {latency}',
      'language.label': 'Language', 'language.zh': '简体中文', 'language.en': 'English', 'language.changed': 'Language changed', 'language.changedDetail': 'The interface language has been updated.',
      'app.modeLive': 'Live mode', 'app.modeDemo': 'Demo mode', 'app.statusChecking': 'checking…', 'app.statusUnknown': 'status unknown', 'app.localOnly': 'visible on this device only',
      'action.addHost': 'Add a host', 'common.sunshineHost': 'Sunshine host', 'diagnostic.noHost': 'Add or select a Sunshine host first.', 'diagnostic.waiting': 'Waiting for diagnostic results', 'diagnostic.controlPort': 'Control port', 'diagnostic.rtspPort': 'RTSP port', 'diagnostic.reachable': 'reachable', 'diagnostic.unreachable': 'unreachable', 'host.noHostsHint': 'Add a host address and the Bridge will read live information from Sunshine.', 'host.offlineHint': 'The host is not reachable right now; refresh it or wake it first.', 'host.refreshDone': 'Host information refreshed', 'host.refreshFailed': 'Could not refresh host', 'host.unpaired': 'Not paired', 'library.available': 'Available to launch', 'library.empty': 'No synced applications yet.', 'library.emptyHint': 'Pair a host first, then refresh its application list.', 'library.play': 'Launch {name}', 'network.available': 'reachable', 'network.certificate': 'certificate saved', 'network.controlPort': 'control port', 'network.rtspPort': 'RTSP port', 'network.controlOnly': 'control plane only', 'network.degraded': 'degraded', 'network.excellent': 'excellent', 'network.linkQuality': 'LINK QUALITY', 'network.notProbed': 'not probed', 'network.paired': 'paired', 'network.pairing': 'PAIRING', 'network.waiting': 'waiting', 'overview.noHost': 'No saved host', 'overview.noHostMeta': 'Add a Sunshine host to see its live status here.', 'overview.noHostStatus': 'Waiting for host', 'overview.noSessionMeta': 'No streaming session recorded yet', 'session.stopFailed': 'Could not end session', 'settings.autosaved': 'Settings save automatically', 'settings.disabled': 'Disabled', 'settings.enabled': 'Enabled', 'settings.outputDefaults': 'Output defaults', 'settings.updated': 'Settings updated', 'signal.degradedPath': 'Packet loss detected', 'signal.waiting': 'Waiting for diagnostic', 'toast.portsCopiedDetail': 'Sunshine control and media ports copied to the clipboard.',
      'meta.title': 'Sunbridge / Web Client', 'meta.description': 'Sunbridge: stream a Sunshine host to your browser — video, audio and input.',
      'aria.navigation': 'Primary navigation', 'aria.connectionDiagnostic': 'Run connection diagnostic', 'aria.profileSettings': 'Open profile settings', 'aria.quickSettings': 'Quick settings', 'aria.closeSettings': 'Close settings', 'aria.sessionSettings': 'Session settings', 'aria.signalChart': 'Network signal history illustration', 'aria.stableLatency': 'Stable latency line', 'aria.hostDetails': 'Host details', 'aria.addHost': 'Add a host', 'aria.language': 'Interface language', 'aria.pairModal': 'Pair a Sunshine host', 'aria.closePair': 'Close pairing dialog', 'aria.streamOverlay': 'Streaming session status', 'aria.endSession': 'End session',
      'aria.bridgeStatus': 'Local Sunbridge status',
      'network.roundTrip': 'Round trip', 'network.stable': 'stable', 'network.trusted': 'Trusted', 'network.certificateShort': 'certificate', 'network.requestSession': 'REQUEST / SESSION', 'network.browserToBridgeHost': 'Browser → bridge → host', 'network.webClient': 'Sunbridge Web', 'network.httpsUi': 'HTTPS / UI', 'network.localBridge': 'Local bridge', 'network.websocketDecode': 'WebSocket + decode', 'network.transportObservatory': 'TRANSPORT OBSERVATORY', 'network.sunshineDefaults': 'Sunshine defaults', 'network.liveDiagnostic': 'LIVE DIAGNOSTIC', 'network.copy': 'Copy',
      'settings.clientPreferences': 'CLIENT PREFERENCES', 'settings.makeItYours': 'Make it yours.', 'settings.smallControls': 'Small controls for a calmer streaming session.', 'settings.streamProfile': 'STREAM PROFILE', 'settings.autosavedLabel': 'Autosaved',
      'pair.addressPlaceholder': '192.168.1.42 or host name', 'pair.namePlaceholder': 'My gaming rig', 'pair.pinPlaceholder': '4-digit PIN',
      'drawer.qualityBalanced': 'Balanced · 1080p60', 'drawer.qualitySharp': 'Sharp · 1440p60', 'drawer.qualityUltra': 'Ultra · 4K60',
      'session.controlStarting': 'CONTROL / STARTING', 'session.rtspPrefix': 'RTSP', 'session.rtspProbing': 'RTSP / PROBING', 'session.rtspConnected': 'RTSP / CONNECTED', 'session.rtspFailed': 'RTSP / FAILED', 'session.rtspUnsupported': 'RTSP / UNSUPPORTED', 'session.rtspDemo': 'RTSP / DEMO', 'session.rtspUnknown': 'RTSP / UNKNOWN', 'session.rtspDetail': 'Probing RTSP OPTIONS and DESCRIBE…', 'session.rtspConnectedDetail': 'RTSP responded; browser media transport is not connected yet.', 'session.rtspFailedDetail': 'RTSP probing failed; check the RTSP port and Sunshine session.', 'session.rtspUnsupportedDetail': 'Sunshine returned encrypted RTSP; the Bridge does not decrypt media yet.', 'session.mediaPrefix': 'MEDIA', 'session.mediaNotConnected': 'MEDIA / NOT CONNECTED', 'session.mediaConnected': 'MEDIA / CONNECTED', 'session.mediaDemo': 'MEDIA / DEMO', 'session.mediaUnknown': 'MEDIA / UNKNOWN', 'session.mediaConnectedDetail': 'Media transport reports connected, but the browser decoder is not attached yet.', 'session.rtspNegotiated': 'RTSP / NEGOTIATED', 'session.rtspNegotiatedDetail': 'RTSP completed OPTIONS, DESCRIBE, SETUP, ANNOUNCE, and PLAY.', 'session.mediaWaiting': 'MEDIA / WAITING FOR DATA', 'session.mediaWaitingDetail': 'RTSP is negotiated; waiting for Sunshine UDP media packets.', 'session.mediaFirstPacket': 'MEDIA FIRST PACKET', 'session.browserDecoderPending': 'RTP media is arriving; the browser decoder is not attached yet.', 'session.videoPackets': 'VIDEO PACKETS', 'session.audioPackets': 'AUDIO PACKETS', 'session.receivingBitrate': 'RECEIVING BITRATE', 'session.negotiationTime': 'NEGOTIATION', 'session.firstPacket': 'FIRST PACKET', 'session.lastPacket': 'LAST PACKET', 'session.packetCount': 'PACKETS', 'session.mediaBytes': 'MEDIA BYTES', 'session.videoBytes': 'VIDEO BYTES', 'session.audioBytes': 'AUDIO BYTES', 'session.mediaState': 'MEDIA STATE', 'session.inputPrefix': 'INPUT', 'session.inputNotConnected': 'INPUT / NOT CONNECTED', 'session.inputConnected': 'INPUT / CONNECTED', 'aria.logout': 'Log out', 'session.inputConnecting': 'INPUT / CONNECTING', 'session.inputFailed': 'INPUT / FAILED', 'session.inputCaptured': 'INPUT / MOUSE CAPTURED', 'session.hostTerminated': 'The Sunshine host ended the stream.', 'session.inputDemo': 'INPUT / DEMO', 'session.inputUnknown': 'INPUT / UNKNOWN', 'session.demoDetail': 'Demo sessions only show state; they do not connect to Sunshine media.',
      'error.code.INVALID_ADDRESS': 'Invalid Sunshine address', 'error.code.INVALID_PORT': 'Invalid Sunshine port', 'error.code.INVALID_PIN': 'Incorrect PIN or pairing failed', 'error.code.NOT_PAIRED': 'Pair the host before starting a session', 'error.code.SUNSHINE_UNAVAILABLE': 'Sunshine host is unavailable', 'error.code.SUNSHINE_REQUEST_FAILED': 'Sunshine request failed', 'error.code.RTSP_NEGOTIATION_FAILED': 'RTSP media negotiation failed', 'error.code.RTSP_ENCRYPTED_UNSUPPORTED': 'Encrypted RTSP media is not supported yet', 'error.code.MEDIA_NOT_CONNECTED': 'Media transport is not connected', 'error.code.INPUT_NOT_CONNECTED': 'Input transport is not connected', 'error.code.TLS_CERTIFICATE_MISMATCH': 'Sunshine TLS certificate does not match the paired certificate', 'error.code.HOST_NOT_FOUND': 'Sunshine host not found', 'error.code.WAKE_MAC_REQUIRED': 'A MAC address is required to wake this host', 'error.code.BRIDGE_ERROR': 'Local Bridge request failed',
      'common.ok': 'OK',

    },
  };

  Object.assign(messages['zh-CN'], {
    'session.mediaGatewayWaiting': 'BROWSER / WS WAITING',
    'session.mediaGatewayConnected': 'BROWSER / WS CONNECTED',
    'session.mediaGatewayDisconnected': 'BROWSER / WS DISCONNECTED',
    'session.mediaGatewayUnsupported': 'BROWSER / WS UNSUPPORTED',
    'session.mediaGatewayFailed': 'BROWSER / WS FAILED',
    'session.videoDecoderUnsupported': '浏览器不支持 WebCodecs H.264 解码。',
    'session.videoWaitingForKeyframe': '正在等待 H.264 关键帧…',
    'session.videoPlaying': '浏览器正在解码 H.264 视频。',
    'session.videoDecodeFailed': 'H.264 解码失败；媒体包仍会继续统计。',
    'session.browserPackets': 'BROWSER PACKETS',
    'session.browserMedia': 'BROWSER MEDIA',
    'session.decoder': 'DECODER',
    'session.audioDecoder': 'AUDIO DECODER',
    'session.audioOutput': 'AUDIO OUTPUT',
    'session.audioWaiting': '正在等待 Opus 音频…',
    'session.audioReceiving': '正在接收 Opus 音频。',
    'session.audioPlaying': '音频正在播放。',
    'session.audioUnsupported': '浏览器不支持 Opus AudioDecoder。',
    'session.audioAutoplayBlocked': '音频等待用户启用。',
    'session.audioDecodeFailed': 'Opus 音频解码失败。',
    'session.audioOutputActive': '音频输出正常',
    'session.audioOutputPending': '等待音频输出',
    'session.audioOutputBlocked': '音频输出被浏览器阻止',
    'session.audioOutputUnavailable': '音频输出不可用',
    'session.enableAudio': '启用音频',
    'session.enableAudioDetail': '点击恢复 Web Audio 输出。',
    'session.browserMediaWaiting': '浏览器媒体网关等待连接',
    'session.browserMediaConnected': '浏览器媒体网关已连接；正在等待可解码视频。',
    'session.browserMediaUnsupported': '浏览器媒体网关或 WebCodecs 不受支持。',
    'session.browserMediaDisconnected': '浏览器媒体网关已断开。',
    'session.browserMediaFailed': '浏览器媒体网关连接失败。',
    'session.browserDecoderPending': 'RTP 媒体正在到达；浏览器解码器尚未接入。',
    'error.mediaGatewayUnsupported': '当前浏览器不支持实时媒体网关或 WebCodecs。',
    'error.mediaGatewayDisconnected': '浏览器媒体网关已断开。',
    'error.mediaGatewayFailed': '无法连接本地浏览器媒体网关。',
    'error.audioDecoderUnsupported': '当前浏览器不支持 Opus 音频解码。',
    'error.audioDecodeFailed': 'Opus 音频解码失败。',
    'aria.streamVideo': 'Sunshine 实时视频画布',
    'aria.enableAudio': '启用音频输出',
  });
  Object.assign(messages['en-US'], {
    'session.mediaGatewayWaiting': 'BROWSER / WS WAITING',
    'session.mediaGatewayConnected': 'BROWSER / WS CONNECTED',
    'session.mediaGatewayDisconnected': 'BROWSER / WS DISCONNECTED',
    'session.mediaGatewayUnsupported': 'BROWSER / WS UNSUPPORTED',
    'session.mediaGatewayFailed': 'BROWSER / WS FAILED',
    'session.videoDecoderUnsupported': 'This browser does not support WebCodecs H.264 decoding.',
    'session.videoWaitingForKeyframe': 'Waiting for an H.264 keyframe…',
    'session.videoPlaying': 'The browser is decoding H.264 video.',
    'session.videoDecodeFailed': 'H.264 decoding failed; media packets are still counted.',
    'session.browserPackets': 'BROWSER PACKETS',
    'session.browserMedia': 'BROWSER MEDIA',
    'session.decoder': 'DECODER',
    'session.audioDecoder': 'AUDIO DECODER',
    'session.audioOutput': 'AUDIO OUTPUT',
    'session.audioWaiting': 'Waiting for Opus audio…',
    'session.audioReceiving': 'Receiving Opus audio.',
    'session.audioPlaying': 'Audio is playing.',
    'session.audioUnsupported': 'This browser does not support the Opus AudioDecoder.',
    'session.audioAutoplayBlocked': 'Audio is waiting for user activation.',
    'session.audioDecodeFailed': 'Opus audio decoding failed.',
    'session.audioOutputActive': 'AUDIO OUTPUT ACTIVE',
    'session.audioOutputPending': 'AUDIO OUTPUT PENDING',
    'session.audioOutputBlocked': 'AUDIO OUTPUT BLOCKED',
    'session.audioOutputUnavailable': 'AUDIO OUTPUT UNAVAILABLE',
    'session.enableAudio': 'Enable audio',
    'session.enableAudioDetail': 'Click to resume Web Audio output.',
    'session.browserMediaWaiting': 'Browser media gateway is waiting for a connection',
    'session.browserMediaConnected': 'Browser media gateway connected; waiting for decodable video.',
    'session.browserMediaUnsupported': 'The browser media gateway or WebCodecs is unsupported.',
    'session.browserMediaDisconnected': 'The browser media gateway disconnected.',
    'session.browserMediaFailed': 'The browser media gateway connection failed.',
    'session.browserDecoderPending': 'RTP media is arriving; the browser decoder is not attached yet.',
    'error.mediaGatewayUnsupported': 'This browser does not support the live media gateway or WebCodecs.',
    'error.mediaGatewayDisconnected': 'The browser media gateway disconnected.',
    'error.mediaGatewayFailed': 'The local browser media gateway could not connect.',
    'error.audioDecoderUnsupported': 'This browser does not support Opus audio decoding.',
    'error.audioDecodeFailed': 'Opus audio decoding failed.',
    'aria.streamVideo': 'Sunshine live video canvas',
    'aria.enableAudio': 'Enable audio output',
  });

  // Host management panel (the ⋯ button on a host).
  Object.assign(messages['zh-CN'], {
    'hostm.eyebrow': '主机管理', 'hostm.connection': '连接', 'hostm.name': '名称', 'hostm.address': '地址',
    'hostm.addressPlaceholder': 'IP、域名或 IPv6，可带端口', 'hostm.httpPort': 'HTTP 端口', 'hostm.httpsPort': 'HTTPS 端口',
    'hostm.mac': 'MAC（网络唤醒）', 'hostm.macPlaceholder': '可留空', 'hostm.portDefault': '默认 {port}',
    'hostm.connectionHint': '修改地址不会影响配对：配对绑定的是 Sunshine 的证书，不是 IP 或域名。',
    'hostm.stream': '串流', 'hostm.resolution': '分辨率', 'hostm.fps': '帧率', 'hostm.bitrate': '码率（Mbps）',
    'hostm.followGlobal': '跟随全局 · {value}', 'hostm.bitrateAuto': '自动 · 约 {value}',
    'hostm.streamHint': '只对这台主机生效；选“跟随全局”或留空则使用设置页的默认值。码率越高画质越好，但需要更多带宽。',
    'hostm.save': '保存更改', 'hostm.saved': '已保存', 'hostm.savedDetail': '{name} 的设置已更新。', 'hostm.saveFailed': '保存失败',
    'hostm.pairing': '配对', 'hostm.pairedWith': '已配对。Sunshine 证书指纹：', 'hostm.notPaired': '还没有配对，配对后才能读取应用列表和开始串流。',
    'hostm.pairNow': '配对这台主机', 'hostm.copyFingerprint': '复制指纹', 'hostm.copied': '已复制',
    'hostm.danger': '危险操作', 'hostm.unpair': '取消配对', 'hostm.delete': '删除主机',
    'hostm.unpairDetail': '删除本 Bridge 保存的配对证书。Sunshine 不提供远程取消配对，如需彻底移除，请再到 Sunshine 网页的“客户端”列表里删除本设备。',
    'hostm.deleteDetail': '从列表中移除这台主机，同时删除它的配对信息和串流设置。',
    'hostm.confirmUnpair': '再点一次确认', 'hostm.confirmDelete': '再点一次确认',
    'hostm.unpaired': '已取消配对', 'hostm.unpairedDetail': '记得到 Sunshine 网页的“客户端”里删除本设备。', 'hostm.deleted': '已删除主机',
    'hostm.actionFailed': '操作失败', 'aria.closeHost': '关闭主机管理', 'action.manageHost': '管理主机',
    'error.code.HOST_BUSY': '这台主机正在串流，请先结束会话。', 'error.code.HOST_EXISTS': '已经有一台主机使用这个地址。',
    'error.code.INVALID_STREAM_SETTINGS': '串流参数超出范围。', 'error.code.INVALID_NAME': '主机名称不能为空，且不超过 64 个字符。',
  });
  Object.assign(messages['en-US'], {
    'hostm.eyebrow': 'HOST SETTINGS', 'hostm.connection': 'Connection', 'hostm.name': 'Name', 'hostm.address': 'Address',
    'hostm.addressPlaceholder': 'IP, domain or IPv6, port optional', 'hostm.httpPort': 'HTTP port', 'hostm.httpsPort': 'HTTPS port',
    'hostm.mac': 'MAC (Wake-on-LAN)', 'hostm.macPlaceholder': 'Optional', 'hostm.portDefault': 'Default {port}',
    'hostm.connectionHint': 'Changing the address keeps the pairing: it is tied to the Sunshine certificate, not the IP or domain.',
    'hostm.stream': 'Streaming', 'hostm.resolution': 'Resolution', 'hostm.fps': 'Frame rate', 'hostm.bitrate': 'Bitrate (Mbps)',
    'hostm.followGlobal': 'Default · {value}', 'hostm.bitrateAuto': 'Auto · about {value}',
    'hostm.streamHint': 'Applies to this host only; "Default" or an empty field uses the values from Settings. Higher bitrate looks better but needs more bandwidth.',
    'hostm.save': 'Save changes', 'hostm.saved': 'Saved', 'hostm.savedDetail': '{name} has been updated.', 'hostm.saveFailed': 'Could not save',
    'hostm.pairing': 'Pairing', 'hostm.pairedWith': 'Paired. Sunshine certificate fingerprint:', 'hostm.notPaired': 'Not paired yet. Pair to load apps and start streaming.',
    'hostm.pairNow': 'Pair this host', 'hostm.copyFingerprint': 'Copy fingerprint', 'hostm.copied': 'Copied',
    'hostm.danger': 'Danger zone', 'hostm.unpair': 'Unpair', 'hostm.delete': 'Delete host',
    'hostm.unpairDetail': 'Removes the pairing certificate stored on this bridge. Sunshine has no remote unpair, so also remove this device under Clients in the Sunshine web UI.',
    'hostm.deleteDetail': 'Removes this host from the list, together with its pairing and stream settings.',
    'hostm.confirmUnpair': 'Click again to confirm', 'hostm.confirmDelete': 'Click again to confirm',
    'hostm.unpaired': 'Pairing removed', 'hostm.unpairedDetail': 'Also remove this device under Clients in the Sunshine web UI.', 'hostm.deleted': 'Host deleted',
    'hostm.actionFailed': 'Action failed', 'aria.closeHost': 'Close host settings', 'action.manageHost': 'Manage host',
    'error.code.HOST_BUSY': 'This host is streaming. End the session first.', 'error.code.HOST_EXISTS': 'Another host already uses this address.',
    'error.code.INVALID_STREAM_SETTINGS': 'A stream setting is out of range.', 'error.code.INVALID_NAME': 'The name must be 1 to 64 characters.',
  });

  // Streaming stats overlay.
  Object.assign(messages['zh-CN'], {
    'stats.video': '画面', 'stats.stream': '请求规格', 'stats.decodedSize': '实际画面', 'stats.renderedFps': '显示帧率', 'stats.decodedFps': '解码帧率', 'stats.receivedFps': '接收帧率', 'stats.codec': '编码', 'stats.decodeQueue': '解码队列', 'stats.backlogResets': '积压清空 {count} 次',
    'stats.network': '网络', 'stats.traffic': '实时流量', 'stats.targetBitrate': '目标码率', 'stats.hostRtt': 'Bridge ↔ 主机 RTT', 'stats.browserRtt': '浏览器 ↔ Bridge RTT',
    'stats.frameLoss': '网络丢帧', 'stats.lostTotal': '累计 {count}', 'stats.fecRecovered': 'FEC 恢复分片', 'stats.congestionDrops': '拥塞丢弃包',
    'stats.latency': '延迟', 'stats.hostProcessing': '主机编码', 'stats.networkOneWay': '网络（单程估算）', 'stats.assembly': '组帧等待', 'stats.decode': '浏览器解码', 'stats.total': '估算总延迟',
    'stats.status': '连接状态', 'stats.rtsp': 'RTSP', 'stats.videoDecoder': '视频解码', 'stats.audio': '音频', 'stats.input': '输入', 'stats.gateway': '媒体网关',
    'stats.footnote': '总延迟 = 主机编码 + 两段网络单程（RTT 的一半）+ 组帧 + 解码，不含显示器刷新。Ctrl+Alt+Shift+S 展开 / 收起。',
  });
  Object.assign(messages['en-US'], {
    'stats.video': 'Video', 'stats.stream': 'Requested', 'stats.decodedSize': 'Actual video', 'stats.renderedFps': 'Displayed', 'stats.decodedFps': 'Decoded', 'stats.receivedFps': 'Received', 'stats.codec': 'Codec', 'stats.decodeQueue': 'Decode queue', 'stats.backlogResets': '{count} backlog resets',
    'stats.network': 'Network', 'stats.traffic': 'Live traffic', 'stats.targetBitrate': 'Target bitrate', 'stats.hostRtt': 'Bridge ↔ host RTT', 'stats.browserRtt': 'Browser ↔ bridge RTT',
    'stats.frameLoss': 'Frames lost', 'stats.lostTotal': '{count} total', 'stats.fecRecovered': 'FEC recovered', 'stats.congestionDrops': 'Congestion drops',
    'stats.latency': 'Latency', 'stats.hostProcessing': 'Host encode', 'stats.networkOneWay': 'Network (one way, est.)', 'stats.assembly': 'Frame assembly', 'stats.decode': 'Browser decode', 'stats.total': 'Estimated total',
    'stats.status': 'Connection', 'stats.rtsp': 'RTSP', 'stats.videoDecoder': 'Video decoder', 'stats.audio': 'Audio', 'stats.input': 'Input', 'stats.gateway': 'Media gateway',
    'stats.footnote': 'Total = host encode + both network legs one way (half the RTT) + assembly + decode, excluding the display. Ctrl+Alt+Shift+S to expand / collapse.',
  });

  // Control modes, adaptive resolution, adaptive bitrate, reconnect.
  Object.assign(messages['zh-CN'], {
    'settings.adaptive': '自适应', 'settings.adaptiveShort': '自适应', 'settings.adaptiveWindow': '自适应（跟随窗口）',
    'settings.controlMode': '控制模式', 'settings.controlModeHint': '远程桌面：普通鼠标指针和触控手势；游戏：锁定鼠标、相对移动',
    'settings.bitrateMode': '码率控制', 'settings.bitrateModeHint': '自动：按 Bridge 到浏览器的网络状况调整，码率设置作为上限',
    'control.auto': '自动（桌面用远程桌面模式）', 'control.desktop': '远程桌面模式', 'control.game': '游戏模式',
    'control.desktopShort': '桌面', 'control.gameShort': '游戏', 'control.toggleHint': '切换远程桌面 / 游戏控制模式',
    'control.desktopHint': '鼠标不锁定，按绝对位置点击；触屏：单指点按 / 拖动，长按或双指点按 = 右键，双指滑动 = 滚动。',
    'control.gameHint': '点击画面锁定鼠标，相对移动；Ctrl+Alt+Shift+Z 释放。',
    'control.fullscreen': '全屏（可捕获 Win、Alt+Tab 等系统按键）', 'control.exitFullscreen': '退出全屏', 'control.keyboard': '屏幕键盘',
    'bitrate.auto': '自动', 'bitrate.fixed': '固定',
    'bitrate.state.starting': '启动中', 'bitrate.state.stable': '稳定', 'bitrate.state.probing': '逐步提升', 'bitrate.state.holding': '保持', 'bitrate.state.congested': '网络拥塞，已降低',
    'stats.bitrateControl': '码率控制', 'codec.auto': '自动（AV1 / HEVC 优先）', 'stats.transport': '传输', 'stats.transportFrames': '整帧（已省去 {fec}% FEC）', 'stats.transportPackets': 'RTP 包', 'stats.audioPackets': '音频 {ms} ms 包', 'stats.hostRate': '主机实际码率', 'stats.encoderSetting': '编码器 {value}', 'stats.audioBuffer': '音频缓冲', 'stats.audioTarget': '目标 {value} ms', 'stats.audioUnderruns': '音频断流次数',
    'reconnect.hostEnded': '主机结束了串流（在 Sunshine 中停止、应用退出或被其他设备接管）。', 'reconnect.hostDisconnected': '主机断开了这个串流连接（在 Sunshine 中断开了本设备，或主机判定连接超时）。',
    'reconnect.stall': '画面中断，正在等待主机…', 'reconnect.stallDetail': '已经 {seconds} 秒没有收到数据，连接仍在；持续中断时会自动重连。', 'stats.drainEpisodes': '排空 {count} 次', 'stats.queueDelay': '排队延迟', 'stats.reconnects': '重连次数',
    'reconnect.host': '与主机的连接中断，正在重连…', 'reconnect.bridge': '与 Bridge 的连接中断，正在重连…', 'reconnect.attempt': '第 {attempt} / {max} 次',
    'reconnect.reason.control': '控制流断开', 'reconnect.reason.media-stall': '长时间没有收到画面', 'reconnect.reason.resize': '调整分辨率', 'reconnect.reason.bitrate': '调整码率', 'reconnect.reason.manual': '手动重连',
    'reconnect.appExited': '主机上的应用已经退出。', 'reconnect.failed': '多次重连失败，会话已结束；主机上的应用仍在运行，可以重新连接。',
    'reconnect.replaced': '这个 Bridge 上已经开始了另一个会话。', 'reconnect.stoppedElsewhere': '会话已在其他设备上结束。',
    'resume.title': '有一个串流正在进行', 'resume.detail': '{app} · {host}', 'resume.return': '回到串流', 'resume.end': '结束',
    'hostm.bitrate': '码率 / 上限（Mbps）',
  });
  Object.assign(messages['en-US'], {
    'settings.adaptive': 'Adaptive', 'settings.adaptiveShort': 'Auto', 'settings.adaptiveWindow': 'Adaptive (match window)',
    'settings.controlMode': 'Control mode', 'settings.controlModeHint': 'Remote desktop: normal pointer and touch gestures; game: locked mouse, relative motion',
    'settings.bitrateMode': 'Bitrate', 'settings.bitrateModeHint': 'Auto: follows the bridge-to-browser network; the bitrate setting is the cap',
    'control.auto': 'Auto (remote desktop for Desktop)', 'control.desktop': 'Remote desktop mode', 'control.game': 'Game mode',
    'control.desktopShort': 'Desktop', 'control.gameShort': 'Game', 'control.toggleHint': 'Switch between remote desktop and game controls',
    'control.desktopHint': 'Mouse is not locked and clicks where you point. Touch: tap / drag, long press or two-finger tap = right click, two-finger swipe = scroll.',
    'control.gameHint': 'Click the video to lock the mouse (relative motion); Ctrl+Alt+Shift+Z releases it.',
    'control.fullscreen': 'Fullscreen (captures Win, Alt+Tab and other system keys)', 'control.exitFullscreen': 'Exit fullscreen', 'control.keyboard': 'On-screen keyboard',
    'bitrate.auto': 'Auto', 'bitrate.fixed': 'Fixed',
    'bitrate.state.starting': 'starting', 'bitrate.state.stable': 'stable', 'bitrate.state.probing': 'stepping up', 'bitrate.state.holding': 'holding', 'bitrate.state.congested': 'congested, lowered',
    'stats.bitrateControl': 'Bitrate control', 'codec.auto': 'Auto (AV1 / HEVC first)', 'stats.transport': 'Transport', 'stats.transportFrames': 'whole frames ({fec}% FEC saved)', 'stats.transportPackets': 'RTP packets', 'stats.audioPackets': 'audio {ms} ms packets', 'stats.hostRate': 'Host actual rate', 'stats.encoderSetting': 'encoder {value}', 'stats.audioBuffer': 'Audio buffer', 'stats.audioTarget': 'target {value} ms', 'stats.audioUnderruns': 'Audio underruns',
    'reconnect.hostEnded': 'The host ended the stream (stopped in Sunshine, the app quit, or another device took over).', 'reconnect.hostDisconnected': 'The host closed this stream (this device was disconnected in Sunshine, or the host timed the connection out).',
    'reconnect.stall': 'Video interrupted, waiting for the host…', 'reconnect.stallDetail': 'No data for {seconds} s; the connection is still up and will reconnect automatically if this persists.', 'stats.drainEpisodes': '{count} drains', 'stats.queueDelay': 'Queueing delay', 'stats.reconnects': 'Reconnects',
    'reconnect.host': 'Connection to the host lost, reconnecting…', 'reconnect.bridge': 'Connection to the bridge lost, reconnecting…', 'reconnect.attempt': 'Attempt {attempt} of {max}',
    'reconnect.reason.control': 'control stream dropped', 'reconnect.reason.media-stall': 'no video for a while', 'reconnect.reason.resize': 'changing resolution', 'reconnect.reason.bitrate': 'changing bitrate', 'reconnect.reason.manual': 'manual',
    'reconnect.appExited': 'The app on the host has exited.', 'reconnect.failed': 'Reconnecting failed repeatedly and the session ended; the app is still running on the host, so you can connect again.',
    'reconnect.replaced': 'Another session was started on this bridge.', 'reconnect.stoppedElsewhere': 'The session was ended on another device.',
    'resume.title': 'A stream is running', 'resume.detail': '{app} · {host}', 'resume.return': 'Return to stream', 'resume.end': 'End',
    'hostm.bitrate': 'Bitrate / cap (Mbps)',
  });

  const getLocale = () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.includes(stored) ? stored : 'zh-CN';
  };

  const format = (template, params = {}) => String(template ?? '').replace(/\{([\w]+)\}/g, (_, key) => params[key] == null ? `{${key}}` : String(params[key]));
  const t = (key, params) => format(messages[getLocale()]?.[key] ?? messages['en-US'][key] ?? key, params);

  const applyLocale = (locale = getLocale()) => {
    const next = SUPPORTED.includes(locale) ? locale : 'zh-CN';
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    document.documentElement.dataset.locale = next;
    document.title = t('meta.title');
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', t('meta.description'));
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((node) => { node.innerHTML = t(node.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-title]').forEach((node) => { node.title = t(node.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)); });
    const select = document.querySelector('#languageSelect');
    if (select) select.value = next;
    window.dispatchEvent(new CustomEvent('sunbridge:locale', { detail: { locale: next } }));
    return next;
  };

  window.SunbridgeI18n = { messages, getLocale, setLocale: applyLocale, t, supported: SUPPORTED };
  window.t = t;
  // This script is loaded at the end of <body>, so apply the locale immediately.
  // A second pass on DOMContentLoaded keeps the helper safe if it is moved to <head> later.
  const bindLocalePicker = () => {
    applyLocale();
    document.addEventListener('change', (event) => {
      if (event.target.matches('#languageSelect')) applyLocale(event.target.value);
    });
  };
  applyLocale();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindLocalePicker, { once: true });
})();
