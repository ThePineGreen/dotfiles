# Add Homebrew to PATH on macOS
if [[ "$(uname)" == "Darwin" ]]; then
    if [[ -x /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
fi

# Starship prompt
eval "$(starship init zsh)"

# Replace ls with eza
alias ls='eza -al --color=always --group-directories-first --icons' # preferred listing
alias la='eza -a --color=always --group-directories-first --icons'  # all files and dirs
alias ll='eza -l --color=always --group-directories-first --icons'  # long format
alias lt='eza -aT --color=always --group-directories-first --icons' # tree listing
alias l.="eza -a | grep -e '^\.'"

# Common use
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'
alias .....='cd ../../../..'
alias ......='cd ../../../../..'

# AI stuff
alias cp='copilot --disable-builtin-mcps'
alias oc='opencode'

# Command history with timestamps
setopt EXTENDED_HISTORY
HIST_STAMPS="%F %T "