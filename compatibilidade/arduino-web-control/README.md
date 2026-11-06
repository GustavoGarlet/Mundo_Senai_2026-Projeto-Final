# Arduino Control Center

Painel web didático para controlar três LEDs conectados ao Arduino Uno, por USB diretamente no navegador ou por rede local com Node.js.

## Hardware

- Arduino Uno R3 e cabo USB de dados
- 3 LEDs e 3 resistores de 220–330 ohms
- Protoboard e jumpers
- Computador com Arduino IDE e Node.js LTS

## Ligações

Para cada LED, ligue o pino digital ao resistor e depois ao anodo do LED. Ligue o cátodo ao GND:

- Vermelho: D8 → resistor → anodo; cátodo → GND
- Verde: D9 → resistor → anodo; cátodo → GND
- Azul: D10 → resistor → anodo; cátodo → GND

Cada LED precisa de seu próprio resistor em série.

## 1. Carregar o Arduino

1. Abra `arduino/controle_leds.ino` no Arduino IDE.
2. Selecione a placa Arduino Uno e a porta correta.
3. Envie o sketch.
4. Feche o Monitor Serial antes de usar USB direto ou o servidor Node.js.

Taxa serial: 9600 baud.

## 2. Instalar e iniciar o servidor

Instale uma versão LTS do Node.js. Abra um terminal na pasta do projeto e execute:

```bash
npm install
npm start
```

O terminal mostrará os endereços disponíveis, por exemplo `http://localhost:3000` e `http://192.168.1.25:3000`.

## 3. Modo USB direto

1. Abra `http://localhost:3000` no Chrome ou Edge atualizado.
2. Escolha **USB direto**.
3. Clique **Conectar via USB** e selecione a porta do Arduino.
4. Use os botões para controlar os LEDs.

A Web Serial API exige um navegador compatível e uma origem segura. `localhost` é aceito como origem local confiável. Não deixe outro programa usando a mesma porta serial.

## 4. Modo Wi-Fi / rede local

1. Mantenha o Arduino conectado por USB ao computador que executa Node.js.
2. Execute `npm start`.
3. Na saída do terminal, identifique o endereço IP local do computador, por exemplo `192.168.1.25`.
4. Em outro dispositivo na mesma rede, abra `http://192.168.1.25:3000`.
5. Escolha **Wi-Fi / rede**, clique **Atualizar**, selecione a porta serial e clique **Conectar pelo servidor**.
6. Controle os LEDs. O navegador faz requisições HTTP ao servidor, e o servidor envia os comandos ao Uno pela USB.

Se o acesso de outro dispositivo falhar, confira se ambos estão na mesma rede, se o firewall permite conexões de entrada na porta TCP 3000 e se o roteador não usa isolamento de clientes. Redes corporativas ou escolares podem bloquear esse tráfego.

## Como funciona

- USB direto: navegador → Web Serial API → USB → Arduino.
- Rede local: navegador → HTTP → Express/Node.js → porta serial USB → Arduino.

Os comandos permitidos são `RED_ON`, `RED_OFF`, `GREEN_ON`, `GREEN_OFF`, `BLUE_ON`, `BLUE_OFF`, `ALL_ON`, `ALL_OFF` e `STATUS`.

## Solução de problemas

- **Porta ocupada:** feche o Monitor Serial e qualquer outro aplicativo conectado à placa.
- **Porta não aparece:** confira cabo USB de dados, driver da placa e permissões do sistema.
- **Web Serial indisponível:** use Chrome ou Edge atualizado e abra em `localhost`.
- **Servidor não inicia:** verifique a versão do Node.js e execute `npm install` novamente.
- **Celular não abre o painel:** confira o IP do computador, a rede Wi-Fi, o firewall e o isolamento de clientes.
- **Estado inicial não atualiza imediatamente:** aguarde alguns segundos após a conexão; o Uno pode reiniciar quando a porta serial é aberta.

## Segurança

Este é um projeto para rede local e laboratório. Não exponha o servidor diretamente à internet. Para uso real, adicione autenticação, controle de acesso, HTTPS e validações adicionais.
