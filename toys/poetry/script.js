function decodeMessage(inputText) {
    // Extracts hidden capital letters to reveal the message
    return inputText.split('').filter(char => char === char.toUpperCase()).join('');
}

function revealMessage() {
    const inputText = document.getElementById('messageInput').value;
    const hiddenMessage = decodeMessage(inputText);
    document.getElementById('output').innerText = hiddenMessage ? `Hidden Message: ${hiddenMessage}` : 'No hidden message found.';
}
