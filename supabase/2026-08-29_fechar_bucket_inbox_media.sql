-- Fecha o bucket de midia do inbox.
--
-- Ele estava publico: 943 arquivos, entre eles CNH, identidade, boleto e
-- comprovante de cliente, abriam sem login nenhum para qualquer pessoa com o
-- link. Nao da para justificar isso como medida de seguranca adequada.
--
-- ATENCAO A ORDEM: rode este SQL somente depois de o deploy com a leitura pela
-- API de storage estar no ar. Antes disso, a tela do inbox deixa de abrir midia.
update storage.buckets
set public = false
where id = 'inbox-media';

select id, name, public from storage.buckets where id = 'inbox-media';
