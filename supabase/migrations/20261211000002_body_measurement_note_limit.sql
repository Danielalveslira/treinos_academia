-- O formulário já limita observações a 300 caracteres. Preserva textos legados maiores.
alter table public.body_measurements add constraint body_measurements_note_300
check (note is null or char_length(note) <= 300) not valid;
