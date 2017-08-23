using Assets.src.interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.targeting
{
    public class ShrapnelAndDamageExploder : IExploder
    {
        private Rigidbody _exploder;
        private int _shrapnelCOunt;
        private Rigidbody _shrapnel;
        public float ExplosionForce = 30;
        public float ExplosionBaseDamage = 100;
        public string EnemyTag;
        public bool SetEnemyTagOnShrapnel = false;
        public bool TagShrapnel = false;
        private readonly Rigidbody _explosionEffect;

        public ShrapnelAndDamageExploder(Rigidbody exploder, Rigidbody shrapnel, Rigidbody explosionEffect, int shrapnelCount = 50)
        {
            _exploder = exploder;
            _shrapnel = shrapnel;
            _shrapnelCOunt = shrapnelCount;
            _explosionEffect = explosionEffect;
        }

        public void ExplodeNow()
        {
            //list all existing objects to be exploded.
            var gameObjects = UnityEngine.Object.FindObjectsOfType<Rigidbody>();

            //add shrapnel to be exploded
            if (_shrapnelCOunt > 0)
            {
                for (int i = 0; i < _shrapnelCOunt; i++)
                {
                    var location = UnityEngine.Random.insideUnitSphere;
                    var fragment = UnityEngine.Object.Instantiate(_shrapnel, _exploder.position + location, _exploder.transform.rotation);
                    fragment.velocity = _exploder.velocity + (0.3f * ExplosionForce * location);
                    //gameObjects.Add(fragment);

                    if (SetEnemyTagOnShrapnel && !string.IsNullOrEmpty(EnemyTag))
                    {
                        fragment.SendMessage("SetEnemyTag", EnemyTag);
                    }

                    if (TagShrapnel)
                    {
                        fragment.tag = _exploder.tag;
                    }
                }
            }

            //explode everything.
            foreach (var explodedThing in gameObjects)
            {
                explodedThing.AddExplosionForce(ExplosionForce, _exploder.position, 100);
                var distance = (explodedThing.position - _exploder.position).magnitude;
                var damage = ExplosionBaseDamage / (distance * distance);
                explodedThing.transform.SendMessage("ApplyDamage", damage, SendMessageOptions.DontRequireReceiver);
            }

            if (_explosionEffect != null)
            {
                var explosion = UnityEngine.Object.Instantiate(_explosionEffect, _exploder.position, UnityEngine.Random.rotation);
                explosion.velocity = _exploder.velocity;
            }

            GameObject.Destroy(_exploder.gameObject);
        }
    }
}
