#!/bin/bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          QQ-OpenCode Bridge - NapCat 安装脚本           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检查 Bridge 是否已在运行
echo -e "${YELLOW}[检查] Bridge 服务状态...${NC}"
if ss -tlnp | grep -q ":3001"; then
    echo -e "${GREEN}✅ Bridge 已在运行 (端口 3001)${NC}"
else
    echo -e "${YELLOW}⚠️  Bridge 未运行，正在启动...${NC}"
    nohup npx tsx src/index.ts config.json > /tmp/bridge.log 2>&1 &
    sleep 3
    if ss -tlnp | grep -q ":3001"; then
        echo -e "${GREEN}✅ Bridge 已启动 (端口 3001)${NC}"
    else
        echo -e "${RED}❌ Bridge 启动失败，请检查 config.json${NC}"
        exit 1
    fi
fi
echo ""

# 安装 NapCat
echo -e "${YELLOW}[1/3] 安装 NapCat...${NC}"
echo -e "${BLUE}提示: 此步骤需要 sudo 密码来安装系统依赖${NC}"
echo ""

if command -v napcat &> /dev/null || [ -d "$HOME/napcat" ]; then
    echo -e "${GREEN}✅ NapCat 已安装，跳过安装步骤${NC}"
else
    echo -e "${BLUE}正在下载 NapCat 安装脚本...${NC}"
    curl -o /tmp/napcat-install.sh https://nclatest.znin.net/NapNeko/NapCat-Installer/main/script/install.sh
    
    echo -e "${BLUE}开始安装 NapCat (需要输入 sudo 密码)...${NC}"
    bash /tmp/napcat-install.sh --docker n --cli n --proxy 0 --confirm
fi
echo ""

# 配置反向 WS
echo -e "${YELLOW}[2/3] 配置反向 WebSocket...${NC}"

# 查找 NapCat 配置目录
CONFIG_DIR=""
for dir in "$HOME/napcat/config" "$HOME/.config/QQ/NapCat/config" "$HOME/.local/share/napcat/config"; do
    if [ -d "$dir" ]; then
        CONFIG_DIR="$dir"
        break
    fi
done

if [ -z "$CONFIG_DIR" ]; then
    # 尝试查找 onebot11.json
    CONFIG_FILE=$(find "$HOME" -name "onebot11.json" -path "*/NapCat/*" 2>/dev/null | head -1)
    if [ -n "$CONFIG_FILE" ]; then
        CONFIG_DIR=$(dirname "$CONFIG_FILE")
    fi
fi

if [ -n "$CONFIG_DIR" ]; then
    echo -e "${BLUE}找到配置目录: ${CONFIG_DIR}${NC}"
    
    # 查找并更新 onebot11 配置文件
    for config_file in "$CONFIG_DIR/onebot11.json" "$CONFIG_DIR/onebot11_ws.json" "$CONFIG_DIR/onebot11_reverse_ws.json"; do
        if [ -f "$config_file" ]; then
            echo -e "${BLUE}更新配置: ${config_file}${NC}"
            
            # 备份原配置
            cp "$config_file" "${config_file}.bak"
            
            # 更新 ws_reverse_url
            if command -v jq &> /dev/null; then
                jq '.ws_reverse_url = ["ws://localhost:3001"]' "$config_file" > "${config_file}.tmp"
                mv "${config_file}.tmp" "$config_file"
            else
                # 如果没有 jq，用 sed 替换
                sed -i 's/"ws_reverse_url"\s*:\s*\[[^]]*\]/"ws_reverse_url": ["ws:\/\/localhost:3001"]/' "$config_file"
            fi
            
            echo -e "${GREEN}✅ 反向 WS 已配置: ws://localhost:3001${NC}"
            break
        fi
    done
else
    echo -e "${YELLOW}⚠️ 未找到 NapCat 配置目录${NC}"
    echo -e "${BLUE}请手动创建配置文件:~/.config/QQ/NapCat/config/onebot11.json${NC}"
    echo -e "${BLUE}内容为: {\"ws_reverse_url\": [\"ws://localhost:3001\"]}${NC}"
fi
echo ""

# 启动 NapCat
echo -e "${YELLOW}[3/3] 启动 NapCat...${NC}"

if command -v napcat &> /dev/null; then
    echo -e "${BLUE}使用 napcat 命令启动...${NC}"
    napcat start
elif [ -f "$HOME/napcat/napcat.sh" ]; then
    echo -e "${BLUE}使用 ~/napcat/napcat.sh 启动...${NC}"
    cd "$HOME/napcat" && bash napcat.sh &
elif [ -f "$HOME/.config/QQ/NapCat/napcat.sh" ]; then
    echo -e "${BLUE}使用 NapCat 目录下的启动脚本...${NC}"
    cd "$HOME/.config/QQ/NapCat" && bash napcat.sh &
else
    echo -e "${YELLOW}⚠️ 未找到 NapCat 启动脚本${NC}"
    echo -e "${BLUE}请手动启动 NapCat:${NC}"
    echo -e "${BLUE}  napcat start${NC}"
    echo -e "${BLUE}  或${NC}"
    echo -e "${BLUE}  cd ~/napcat && bash napcat.sh${NC}"
fi
echo ""

# 最终状态检查
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                      安装完成                           ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Bridge 状态:${NC}"
if ss -tlnp | grep -q ":3001"; then
    echo -e "  ${GREEN}✅ 运行中 (端口 3001)${NC}"
else
    echo -e "  ${RED}❌ 未运行${NC}"
fi
echo ""
echo -e "${GREEN}NapCat 状态:${NC}"
if ps aux | grep -i napcat | grep -v grep | grep -v install > /dev/null 2>&1; then
    echo -e "  ${GREEN}✅ 运行中${NC}"
else
    echo -e "  ${YELLOW}⚠️  未运行 (请手动启动)${NC}"
fi
echo ""
echo -e "${BLUE}下一步:${NC}"
echo -e "  1. 确保 NapCat 已登录 QQ 账号"
echo -e "  2. 在 QQ 中向 Bot (QQ: $(jq -r '.napcat.botQQ' config.json 2>/dev/null || echo '未知')) 发送 /help 查看帮助"
echo -e "  3. 使用 /bind <项目路径> 绑定项目开始使用"
echo ""
