/**
 * Created by Hongcai Deng on 2015/12/29.
 */

$(function(){
  $('.ui.modal')
    .modal()
  ;

  var clipboard = new Clipboard('.copyable');

  $maillist = $('#maillist');

  $maillist.on('click', 'tr', function() {
    var mail = $(this).data('mail');
    $('#mailcard .header').text(mail.headers.subject || '无主题');
    $('#mailcard .content:last').html(mail.html);
    $('#mailcard i').click(function() {
      $('#raw').modal('show');
    });
    $('#raw .header').text('RAW');
    $('#raw .content').html($('<pre>').html($('<code>').addClass('language-json').html(JSON.stringify(mail, null, 2))));
    Prism.highlightAll();
  });

  var socket = io();
  socket.on('shortid', function(id) {
    var mailaddress = id + '@' + location.hostname;
    $('#shortid').text(mailaddress).siblings('i').attr('data-clipboard-text', mailaddress);
  });

  socket.on('mail', function(mail) {
    $tr = $('<tr>').data('mail', mail);
    $tr
      .append($('<td>').text(mail.headers.from))
      .append($('<td>').text(mail.headers.subject || '无主题'))
      .append($('<td>').text((new Date(mail.headers.date)).toLocaleTimeString()));
    $maillist.prepend($tr);
  });
});
