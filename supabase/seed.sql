-- OPTIONAL illustrative catalog for a new development/staging project.
-- No appointments, client data, admin accounts, passwords or tokens are inserted.
-- Review names, prices and permissions before enabling live bookings.
begin;
insert into public.services(id,category,name,description,price,duration) values
 ('haircut','hair','Стрижка и укладка','Консультация, мытьё и лёгкая укладка.',2200,60),
 ('color','hair','Окрашивание в один тон','Ровный оттенок и бережная формула.',5500,120),
 ('styling','hair','Укладка и локоны','Естественное движение и объём.',1800,60),
 ('treatment','hair','Восстановление волос','Глубокий уход для мягкости и гладкости.',3000,90),
 ('manicure','nails','Маникюр с покрытием','Маникюр, выравнивание и покрытие.',1800,90),
 ('pedicure','nails','Педикюр с покрытием','Уход за стопами и стойкое покрытие.',2400,90),
 ('nude','nails','Маникюр без покрытия','Аккуратный уход за натуральными ногтями.',1000,60),
 ('brows','brows','Архитектура бровей','Коррекция и окрашивание.',1200,60),
 ('lamination','brows','Ламинирование ресниц','Выразительный изгиб ресниц.',2000,90),
 ('makeup','makeup','Вечерний макияж','Стойкий образ для важного события.',3000,90),
 ('daymakeup','makeup','Лёгкий дневной макияж','Мягкие оттенки и естественная красота.',2000,60),
 ('facial','care','Увлажняющий уход','Очищение, сыворотка и маска.',2800,60),
 ('massage','care','Массаж лица','Расслабление и бережная забота.',2000,60)
on conflict(id) do nothing;
insert into public.masters(id,name,specialty,photo,days,break_start,break_end) values
 ('aida','Аида','Стилист по волосам','/images/master-aida.jpg',array[1,2,3,5,6,0],'13:00','14:00'),
 ('aliya','Алия','Мастер маникюра','/images/master-aliya.jpg',array[1,2,4,5,6,0],'13:00','14:00'),
 ('diana','Диана','Бровист · визажист','/images/master-diana.jpg',array[1,3,4,5,6,0],'13:00','14:00'),
 ('amina','Амина','Специалист по уходу','/images/master-amina.jpg',array[1,2,3,4,6,0],'13:00','14:00'),
 ('elina','Элина','Стилист · визажист','/images/master-elina.jpg',array[2,3,4,5,6,0],'13:00','14:00')
on conflict(id) do nothing;
insert into public.master_services(master_id,service_id) values
 ('aida','haircut'),('aida','color'),('aida','styling'),('aida','treatment'),
 ('aliya','manicure'),('aliya','pedicure'),('aliya','nude'),
 ('diana','brows'),('diana','lamination'),('diana','makeup'),('diana','daymakeup'),
 ('amina','facial'),('amina','massage'),('amina','brows'),
 ('elina','haircut'),('elina','styling'),('elina','makeup'),('elina','daymakeup')
on conflict do nothing;
commit;
