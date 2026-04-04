#!/bin/bash
set -e

# ─── 颜色定义 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── 全局变量 ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.json"
PID_DIR="${SCRIPT_DIR}/.pids"
BRIDGE_PID_FILE="${PID_DIR}/bridge.pid"
LOG_DIR="${SCRIPT_DIR}/logs"
BRIDGE_LOG="${LOG_DIR}/bridge.log"
MAX_LOG_SIZE=10485760  # 10MB

# ─── 辅助函数 ────────────────────────────────────────────────────────────────
print_banner() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║            QQ-OpenCode Bridge - 一键启动脚本             ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_help() {
    print_banner
    echo -e "${CYAN}用法:${NC}"
    echo -e "  $0 [命令]"
    echo ""
    echo -e "${CYAN}命令:${NC}"
    echo -e "  ${GREEN}start${NC}     启动 Bridge 和 NapCat (默认)"
    echo -e "  ${GREEN}stop${NC}      停止 Bridge 服务"
    echo -e "  ${GREEN}restart${NC}   重启 Bridge 服务"
    echo -e "  ${GREEN}status${NC}    查看服务状态"
    echo -e "  ${GREEN}help${NC}      显示此帮助信息"
    echo ""
    echo -e "${CYAN}示例:${NC}"
    echo -e "  $0           # 启动服务"
    echo -e "  $0 start     # 启动服务"
    echo -e "  $0 stop      # 停止服务"
    echo -e "  $0 restart   # 重启服务"
    echo -e "  $0 status    # 查看状态"
    echo ""
}

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${YELLOW}[$1]${NC} $2"
}

# ─── 初始化目录 ──────────────────────────────────────────────────────────────
init_dirs() {
    mkdir -p "$PID_DIR" "$LOG_DIR"
}

# ─── 依赖检查 ────────────────────────────────────────────────────────────────
check_dependencies() {
    log_step "检查" "依赖环境..."
    local missing=()
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        missing+=("Node.js")
    else
        local node_version=$(node --version)
        log_info "Node.js: ${node_version}"
    fi
    
    # 检查 npm
    if ! command -v npm &> /dev/null; then
        missing+=("npm")
    else
        local npm_version=$(npm --version)
        log_info "npm: ${npm_version}"
    fi
    
    # 检查 npx
    if ! command -v npx &> /dev/null; then
        missing+=("npx")
    fi
    
    # 检查 jq (可选)
    if ! command -v jq &> /dev/null; then
        log_warn "jq 未安装，将使用 grep/sed 解析 (功能受限)"
        HAS_JQ=false
    else
        HAS_JQ=true
        log_info "jq: $(jq --version)"
    fi
    
    # 检查 ss 或 netstat
    if ! command -v ss &> /dev/null && ! command -v netstat &> /dev/null; then
        log_warn "ss/netstat 未安装，端口检查将被跳过"
        HAS_PORT_CHECK=false
    else
        HAS_PORT_CHECK=true
    fi
    
    # 如果有缺失的关键依赖，报错退出
    if [ ${#missing[@]} -gt 0 ]; then
        log_error "缺少关键依赖: ${missing[*]}"
        echo -e "${RED}请先安装:${NC}"
        for dep in "${missing[@]}"; do
            case $dep in
                "Node.js")
                    echo -e "  - Node.js: https://nodejs.org/"
                    ;;
                "npm")
                    echo -e "  - npm: 通常随 Node.js 一起安装"
                    ;;
                "npx")
                    echo -e "  - npx: npm install -g npx"
                    ;;
            esac
        done
        exit 1
    fi
    
    log_info "依赖检查通过"
    echo ""
}

# ─── 配置文件检查 ──────────────────────────────────────────────────────────────
check_config() {
    log_step "检查" "配置文件..."
    
    if [ ! -f "$CONFIG_FILE" ]; then
        log_error "未找到 config.json: ${CONFIG_FILE}"
        echo -e "${YELLOW}请先创建配置文件，参考:${NC}"
        echo -e "  cp config.json.example config.json"
        echo -e "  # 然后编辑 config.json 填入你的配置"
        exit 1
    fi
    
    # 解析配置
    if [ "$HAS_JQ" = true ]; then
        BOT_QQ=$(jq -r '.napcat.botQQ' "$CONFIG_FILE")
        NAPCAT_TOKEN=$(jq -r '.napcat.token // empty' "$CONFIG_FILE")
        WS_URL=$(jq -r '.napcat.wsUrl' "$CONFIG_FILE")
        HTTP_URL=$(jq -r '.napcat.httpUrl' "$CONFIG_FILE")
        WS_PORT=$(echo "$WS_URL" | grep -oP ':\K[0-9]+' || echo "3001")
        HTTP_PORT=$(echo "$HTTP_URL" | grep -oP ':\K[0-9]+' || echo "3000")
    else
        BOT_QQ=$(grep -o '"botQQ"\s*:\s*"[^"]*"' "$CONFIG_FILE" | head -1 | grep -o '[0-9]\+')
        NAPCAT_TOKEN=$(grep -o '"token"\s*:\s*"[^"]*"' "$CONFIG_FILE" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
        WS_PORT=3001
        HTTP_PORT=3000
    fi
    
    # 验证必要配置
    if [ -z "$BOT_QQ" ]; then
        log_error "config.json 中缺少 napcat.botQQ 配置"
        exit 1
    fi
    
    if [ -z "$WS_PORT" ]; then
        WS_PORT=3001
    fi
    
    log_info "Bot QQ: ${BOT_QQ}"
    log_info "WS 端口: ${WS_PORT} | HTTP 端口: ${HTTP_PORT}"
    echo ""
}

# ─── PID 文件管理 ──────────────────────────────────────────────────────────────
get_bridge_pid() {
    if [ -f "$BRIDGE_PID_FILE" ]; then
        cat "$BRIDGE_PID_FILE"
    fi
}

# 检查进程树中是否有 index.ts 相关进程
is_bridge_process_tree() {
    local root_pid=$1
    
    # 检查该进程及其所有子进程
    if pgrep -P "$root_pid" 2>/dev/null | while read child_pid; do
        if ps -p "$child_pid" -o args= 2>/dev/null | grep -q "index.ts"; then
            return 0
        fi
    done; then
        return 0
    fi
    
    # 检查该进程本身
    if ps -p "$root_pid" -o args= 2>/dev/null | grep -q "index.ts"; then
        return 0
    fi
    
    return 1
}

is_bridge_running() {
    local pid=$(get_bridge_pid)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    return 1
}

# 检查是否有 index.ts 相关进程在运行
is_bridge_any_running() {
    if pgrep -f "index.ts.*config.json" > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

save_bridge_pid() {
    echo "$1" > "$BRIDGE_PID_FILE"
}

remove_bridge_pid() {
    rm -f "$BRIDGE_PID_FILE"
}

# ─── 端口检查 ────────────────────────────────────────────────────────────────
check_port() {
    local port=$1
    local service=$2
    
    if [ "$HAS_PORT_CHECK" = false ]; then
        return 0
    fi
    
    if ss -tlnp 2>/dev/null | grep -q ":${port} " || \
       netstat -tlnp 2>/dev/null | grep -q ":${port} "; then
        local pid=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | head -1)
        if [ -n "$pid" ]; then
            local proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
            local proc_args=$(ps -p "$pid" -o args= 2>/dev/null || echo "")
            
            # 检查是否是我们的 Bridge 进程
            if [ "$service" = "bridge" ]; then
                # 检查进程或其父进程是否是我们启动的
                local parent_pid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')
                local grandparent_pid=""
                if [ -n "$parent_pid" ]; then
                    grandparent_pid=$(ps -p "$parent_pid" -o ppid= 2>/dev/null | tr -d ' ')
                fi
                
                # 检查是否是 index.ts 相关进程
                if echo "$proc_args" | grep -q "index.ts"; then
                    log_info "端口 ${port} 被 Bridge 进程占用 (PID: ${pid})"
                    return 0
                fi
                
                # 检查父进程是否是我们保存的 PID
                if is_bridge_running; then
                    local bridge_pid=$(get_bridge_pid)
                    if [ "$pid" = "$bridge_pid" ] || [ "$parent_pid" = "$bridge_pid" ] || [ "$grandparent_pid" = "$bridge_pid" ]; then
                        log_info "端口 ${port} 被当前 Bridge 实例占用 (PID: ${pid})"
                        return 0
                    fi
                fi
            fi
            
            log_warn "端口 ${port} 已被占用 (PID: ${pid}, 进程: ${proc_name})"
            return 1
        fi
    fi
    return 0
}

# ─── 日志管理 ────────────────────────────────────────────────────────────────
rotate_log() {
    local log_file=$1
    
    if [ ! -f "$log_file" ]; then
        return
    fi
    
    local log_size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo 0)
    
    if [ "$log_size" -gt "$MAX_LOG_SIZE" ]; then
        local timestamp=$(date +%Y%m%d_%H%M%S)
        mv "$log_file" "${log_file}.${timestamp}"
        log_info "日志已轮转: ${log_file}.${timestamp}"
        
        # 清理旧日志 (保留最近5个)
        ls -t "${log_file}."* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
    fi
}

# ─── 优雅关闭 ────────────────────────────────────────────────────────────────
cleanup() {
    echo ""
    log_warn "收到中断信号，正在清理..."
    stop_bridge
    exit 0
}

trap cleanup SIGINT SIGTERM

# ─── NapCat WebUI 配置 ──────────────────────────────────────────────────────
configure_webui() {
    log_step "1/4" "配置 NapCat WebUI Token..."
    
    # 查找 NapCat 配置目录
    NAPCAT_CONFIG_DIR=""
    for dir in \
        "$HOME/napcat/config" \
        "$HOME/Napcat/opt/QQ/resources/app/app_launcher/napcat/config" \
        "$HOME/.config/QQ/NapCat/config" \
        "$HOME/.local/share/napcat/config" \
        "$HOME/NapCat/config"; do
        if [ -d "$dir" ]; then
            NAPCAT_CONFIG_DIR="$dir"
            break
        fi
    done
    
    # 如果没找到，尝试通过 find 定位
    if [ -z "$NAPCAT_CONFIG_DIR" ]; then
        local webui_path=$(find "$HOME" -name "webui.json" -path "*/napcat/*" -o -name "webui.json" -path "*/NapCat/*" 2>/dev/null | head -1)
        if [ -n "$webui_path" ]; then
            NAPCAT_CONFIG_DIR=$(dirname "$webui_path")
        fi
    fi
    
    if [ -z "$NAPCAT_CONFIG_DIR" ]; then
        if [ -n "$NAPCAT_TOKEN" ]; then
            log_warn "未找到 NapCat 配置目录，跳过 WebUI 配置"
            echo -e "${BLUE}请手动创建: ~/.config/QQ/NapCat/config/webui.json${NC}"
        else
            log_warn "config.json 中未设置 napcat.token，跳过 Token 填充"
        fi
        echo ""
        return
    fi
    
    if [ -z "$NAPCAT_TOKEN" ]; then
        log_warn "config.json 中未设置 napcat.token，跳过 Token 填充"
        echo ""
        return
    fi
    
    local WEBUI_JSON="${NAPCAT_CONFIG_DIR}/webui.json"
    
    if [ -f "$WEBUI_JSON" ]; then
        log_info "找到 WebUI 配置: ${WEBUI_JSON}"
        
        # 备份原配置
        cp "$WEBUI_JSON" "${WEBUI_JSON}.bak"
        
        # 注入 token 到 webui.json
        if [ "$HAS_JQ" = true ]; then
            jq --arg token "$NAPCAT_TOKEN" \
                '.token = $token | .apiToken = ($token // .apiToken)' \
                "$WEBUI_JSON" > "${WEBUI_JSON}.tmp"
            mv "${WEBUI_JSON}.tmp" "$WEBUI_JSON"
            log_info "WebUI Token 已填充"
        else
            if grep -q '"token"' "$WEBUI_JSON"; then
                sed -i "s/\"token\"\s*:\s*\"[^\"]*\"/\"token\": \"${NAPCAT_TOKEN}\"/" "$WEBUI_JSON"
            else
                sed -i "1s/{/{\n  \"token\": \"${NAPCAT_TOKEN}\",/" "$WEBUI_JSON"
            fi
            log_info "WebUI Token 已填充 (sed 模式)"
        fi
    else
        log_info "创建 WebUI 配置: ${WEBUI_JSON}"
        mkdir -p "$NAPCAT_CONFIG_DIR"
        cat > "$WEBUI_JSON" <<EOF
{
  "token": "${NAPCAT_TOKEN}",
  "apiToken": "${NAPCAT_TOKEN}",
  "autoLoginAccount": "${BOT_QQ}"
}
EOF
        log_info "WebUI 配置已创建 (token + 自动登录 QQ: ${BOT_QQ})"
    fi
    echo ""
}

# ─── 反向 WebSocket 配置 ─────────────────────────────────────────────────────
configure_websocket() {
    log_step "2/4" "配置反向 WebSocket..."
    
    if [ -z "$NAPCAT_CONFIG_DIR" ]; then
        log_warn "未找到 NapCat 配置目录"
        echo ""
        return
    fi
    
    local configured=false
    
    for config_file in \
        "$NAPCAT_CONFIG_DIR/onebot11.json" \
        "$NAPCAT_CONFIG_DIR/onebot11_ws.json" \
        "$NAPCAT_CONFIG_DIR/onebot11_reverse_ws.json"; do
        
        if [ -f "$config_file" ]; then
            cp "$config_file" "${config_file}.bak"
            
            if [ "$HAS_JQ" = true ]; then
                jq --arg ws "ws://localhost:${WS_PORT}" \
                    '.ws_reverse_url = ["\($ws)"]' \
                    "$config_file" > "${config_file}.tmp"
                mv "${config_file}.tmp" "$config_file"
            else
                sed -i "s/\"ws_reverse_url\"\s*:\s*\[[^]]*\]/\"ws_reverse_url\": [\"ws:\/\/localhost:${WS_PORT}\"]/" "$config_file"
            fi
            
            log_info "反向 WS 已配置: ws://localhost:${WS_PORT}"
            configured=true
            break
        fi
    done
    
    if [ "$configured" = false ]; then
        log_info "未找到 onebot11 配置文件，自动创建..."
        local onebot11_file="${NAPCAT_CONFIG_DIR}/onebot11.json"
        mkdir -p "$NAPCAT_CONFIG_DIR"
        cat > "$onebot11_file" <<EOF
{
  "http": {
    "enable": true,
    "host": "127.0.0.1",
    "port": ${HTTP_PORT},
    "secret": "${NAPCAT_TOKEN}"
  },
  "ws_reverse_url": ["ws://localhost:${WS_PORT}"]
}
EOF
        log_info "onebot11 配置已创建: ${onebot11_file}"
        log_info "反向 WS: ws://localhost:${WS_PORT} | HTTP: ${HTTP_PORT}"
    fi
    echo ""
}

# ─── 启动 Bridge ─────────────────────────────────────────────────────────────
start_bridge() {
    log_step "3/4" "启动 Bridge 服务..."
    
    # 检查是否已在运行
    if is_bridge_any_running; then
        local pid=$(pgrep -f "index.ts.*config.json" | head -1)
        log_info "Bridge 已在运行 (PID: ${pid})"
        # 更新 PID 文件
        save_bridge_pid "$pid"
        echo ""
        return 0
    fi
    
    # 检查端口冲突
    if ! check_port "$WS_PORT" "bridge"; then
        log_error "端口 ${WS_PORT} 被占用，请先释放该端口或修改配置"
        exit 1
    fi
    
    # 轮转日志
    rotate_log "$BRIDGE_LOG"
    
    log_info "正在启动 Bridge..."
    
    # 启动 Bridge 并保存 PID
    nohup npx tsx "${SCRIPT_DIR}/src/index.ts" "$CONFIG_FILE" \
        >> "$BRIDGE_LOG" 2>&1 &
    local bridge_pid=$!
    
    save_bridge_pid "$bridge_pid"
    log_info "Bridge 启动进程: ${bridge_pid}"
    
    # 等待启动
    local started=false
    for i in $(seq 1 15); do
        sleep 1
        
        # 检查是否有 index.ts 进程在运行
        if is_bridge_any_running; then
            local actual_pid=$(pgrep -f "index.ts.*config.json" | head -1)
            if [ -n "$actual_pid" ]; then
                # 检查端口是否就绪
                if ss -tlnp 2>/dev/null | grep -q ":${WS_PORT}"; then
                    log_info "Bridge 已启动 (PID: ${actual_pid}, 端口 ${WS_PORT})"
                    # 更新为实际的进程 PID
                    save_bridge_pid "$actual_pid"
                    started=true
                    break
                fi
            fi
        fi
        
        # 检查启动进程是否还活着
        if ! kill -0 "$bridge_pid" 2>/dev/null; then
            if ! is_bridge_any_running; then
                log_error "Bridge 进程已退出"
                remove_bridge_pid
                echo -e "${RED}启动失败，查看日志: tail -f ${BRIDGE_LOG}${NC}"
                exit 1
            fi
        fi
        
        if [ "$i" -eq 15 ]; then
            log_error "Bridge 启动超时"
            echo -e "${RED}查看日志: tail -f ${BRIDGE_LOG}${NC}"
            exit 1
        fi
    done
    
    if [ "$started" = false ]; then
        log_warn "Bridge 可能未完全启动，请检查日志"
    fi
    echo ""
}

# ─── 停止 Bridge ─────────────────────────────────────────────────────────────
stop_bridge() {
    log_step "停止" "Bridge 服务..."
    
    # 先尝试通过进程名找到所有相关进程
    local pids=$(pgrep -f "index.ts.*config.json" 2>/dev/null || echo "")
    
    if [ -z "$pids" ]; then
        # 没有找到进程，检查 PID 文件
        local pid=$(get_bridge_pid)
        if [ -n "$pid" ]; then
            if kill -0 "$pid" 2>/dev/null; then
                pids="$pid"
            else
                log_warn "Bridge 进程 ${pid} 不存在"
                remove_bridge_pid
                return 0
            fi
        else
            log_warn "未找到 Bridge 进程"
            return 0
        fi
    fi
    
    log_info "正在停止 Bridge 进程..."
    
    # 停止所有相关进程
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            log_info "停止进程: ${pid}"
            kill "$pid" 2>/dev/null || true
        fi
    done
    
    # 等待进程退出
    local stopped=false
    for i in $(seq 1 10); do
        if ! is_bridge_any_running; then
            stopped=true
            break
        fi
        sleep 1
    done
    
    if [ "$stopped" = false ]; then
        log_warn "优雅关闭超时，强制终止..."
        for pid in $(pgrep -f "index.ts.*config.json" 2>/dev/null || echo ""); do
            kill -9 "$pid" 2>/dev/null || true
        done
        sleep 1
    fi
    
    remove_bridge_pid
    log_info "Bridge 已停止"
    echo ""
}

# ─── 启动 NapCat/QQ ──────────────────────────────────────────────────────────
start_napcat() {
    log_step "4/4" "启动 QQ (NapCat)..."
    
    # 检查 QQ 是否已在运行
    if pgrep -f "qq.*no-sandbox" > /dev/null 2>&1 || pgrep -x "qq" > /dev/null 2>&1; then
        log_info "QQ 已在运行"
        echo ""
        return 0
    fi
    
    local qq_started=false
    
    # 优先使用 napcat 命令
    if command -v napcat &> /dev/null; then
        log_info "使用 napcat 命令启动..."
        nohup napcat start > /dev/null 2>&1 &
        qq_started=true
    # 使用 NapCat 安装目录的 QQ
    elif [ -f "$HOME/Napcat/opt/QQ/qq" ]; then
        log_info "使用 ~/Napcat/opt/QQ/qq 启动..."
        nohup "$HOME/Napcat/opt/QQ/qq" --no-sandbox --disable-gpu --disable-dev-shm-usage > /dev/null 2>&1 &
        qq_started=true
    # 使用 ~/napcat 目录
    elif [ -f "$HOME/napcat/napcat.sh" ]; then
        log_info "使用 ~/napcat/napcat.sh 启动..."
        nohup bash "$HOME/napcat/napcat.sh" > /dev/null 2>&1 &
        qq_started=true
    # 使用 ~/.config/QQ 目录
    elif [ -f "$HOME/.config/QQ/NapCat/napcat.sh" ]; then
        log_info "使用 NapCat 目录下的启动脚本..."
        nohup bash "$HOME/.config/QQ/NapCat/napcat.sh" > /dev/null 2>&1 &
        qq_started=true
    fi
    
    if [ "$qq_started" = false ]; then
        log_warn "未找到 QQ/NapCat"
        echo -e "${BLUE}请手动启动 NapCat:${NC}"
        echo -e "${BLUE}  napcat start${NC}"
        echo -e "${BLUE}  或${NC}"
        echo -e "${BLUE}  ~/Napcat/opt/QQ/qq --no-sandbox${NC}"
    else
        log_info "QQ 启动命令已发送"
        
        # 等待 QQ 启动
        sleep 2
        if pgrep -f "qq" > /dev/null 2>&1; then
            log_info "QQ 进程已启动"
        else
            log_warn "QQ 可能未成功启动，请检查"
        fi
    fi
    echo ""
}

# ─── 显示状态 ────────────────────────────────────────────────────────────────
show_status() {
    print_banner
    
    echo -e "${CYAN}服务状态:${NC}"
    echo -e "${BLUE}────────────────────────────────────────────────────────${NC}"
    
    # Bridge 状态
    if is_bridge_any_running; then
        local pid=$(pgrep -f "index.ts.*config.json" | head -1)
        local uptime=$(ps -p "$pid" -o etime= 2>/dev/null | tr -d ' ' || echo "unknown")
        echo -e "  Bridge:   ${GREEN}✅ 运行中${NC}"
        echo -e "            PID: ${pid}"
        echo -e "            运行时间: ${uptime}"
        echo -e "            端口: ${WS_PORT}"
        echo -e "            日志: ${BRIDGE_LOG}"
    else
        echo -e "  Bridge:   ${RED}❌ 未运行${NC}"
    fi
    
    echo ""
    
    # NapCat 状态
    local napcat_pid=$(pgrep -f "napcat|NapCat" 2>/dev/null | head -1)
    if [ -n "$napcat_pid" ]; then
        local napcat_uptime=$(ps -p "$napcat_pid" -o etime= 2>/dev/null | tr -d ' ' || echo "unknown")
        echo -e "  NapCat:   ${GREEN}✅ 运行中${NC}"
        echo -e "            PID: ${napcat_pid}"
        echo -e "            运行时间: ${napcat_uptime}"
    else
        echo -e "  NapCat:   ${YELLOW}⚠️  未运行${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}────────────────────────────────────────────────────────${NC}"
    echo ""
    
    echo -e "${CYAN}配置信息:${NC}"
    echo -e "  Bot QQ:     ${BOT_QQ}"
    echo -e "  WS 端口:    ${WS_PORT}"
    echo -e "  HTTP 端口:  ${HTTP_PORT}"
    echo -e "  配置文件:   ${CONFIG_FILE}"
    echo ""
    
    echo -e "${CYAN}常用命令:${NC}"
    echo -e "  查看日志:   tail -f ${BRIDGE_LOG}"
    echo -e "  重启服务:   $0 restart"
    echo -e "  停止服务:   $0 stop"
    echo ""
}

# ─── 主流程 ──────────────────────────────────────────────────────────────────
main() {
    local command="${1:-start}"
    
    # 初始化
    init_dirs
    
    case "$command" in
        start)
            print_banner
            check_dependencies
            check_config
            configure_webui
            configure_websocket
            start_bridge
            start_napcat
            
            # 最终状态
            echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║                      启动完成                           ║${NC}"
            echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
            echo ""
            
            show_status
            
            echo -e "${CYAN}下一步:${NC}"
            echo -e "  1. 确保 NapCat 已登录 QQ 账号"
            echo -e "  2. 在 QQ 中向 Bot (QQ: ${BOT_QQ}) 发送 /help 查看帮助"
            echo -e "  3. 使用 /bind <项目路径> 绑定项目开始使用"
            echo ""
            ;;
        
        stop)
            print_banner
            check_config
            stop_bridge
            log_info "服务已停止"
            ;;
        
        restart)
            print_banner
            check_dependencies
            check_config
            stop_bridge
            sleep 1
            start_bridge
            log_info "服务已重启"
            show_status
            ;;
        
        status)
            check_config
            show_status
            ;;
        
        help|--help|-h)
            print_help
            ;;
        
        *)
            log_error "未知命令: ${command}"
            print_help
            exit 1
            ;;
    esac
}

main "$@"
