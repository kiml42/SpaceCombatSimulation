using Assets.Src.Interfaces;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public class ShrapnelExploder : IExploder
    {
        private Rigidbody _exploder;
        private readonly int _shrapnelCount;
        private readonly Rigidbody _shrapnel;
        public float ShrapnelSpeed = 100;
        public List<string> EnemyTags;
        public bool SetEnemyTagOnShrapnel = false;
        public bool TagShrapnel = false;
        private readonly Rigidbody _explosionEffect;
        public bool RandomiseShrapnelOrientation = true;

        public ShrapnelExploder(Rigidbody explodingRigidbody, Rigidbody shrapnel, Rigidbody explosionEffect, int shrapnelCount = 50)
        {
            _exploder = explodingRigidbody;
            _shrapnel = shrapnel;
            _shrapnelCount = shrapnelCount;
            _explosionEffect = explosionEffect;
        }

        public void ExplodeNow(Vector3? velocityOverride = null)
        {
            //Debug.Log(_exploder + " is exploding");
            if (_explosionEffect != null)
            {
                var explosion = Object.Instantiate(_explosionEffect, _exploder.position, _exploder.rotation);
                explosion.velocity = velocityOverride ?? _exploder.velocity;
            }

            //add shrapnel to be exploded
            if (_shrapnelCount > 0 && _shrapnel != null)
            {
                for (int i = 0; i < _shrapnelCount; i++)
                {
                    var location = Random.insideUnitSphere;
                    var fragment = Object.Instantiate(_shrapnel, _exploder.position + location, _exploder.transform.rotation);
                    fragment.velocity = (velocityOverride ?? _exploder.velocity) + (ShrapnelSpeed * location);
                    //gameObjects.Add(fragment);
                    if (RandomiseShrapnelOrientation)
                    {
                        fragment.angularVelocity = Random.insideUnitSphere * Random.Range(0, 1000);
                    }

                    if (SetEnemyTagOnShrapnel && EnemyTags != null && EnemyTags.Any())
                    {
                        fragment.GetComponent<IKnowsEnemyTags>().KnownEnemyTags = EnemyTags;
                    }

                    if (TagShrapnel)
                    {
                        fragment.tag = _exploder.tag;
                    }
                }
            }

            GameObject.Destroy(_exploder.gameObject);
        }

        public void SetExplodingObject(Rigidbody explodingRigidbody)
        {
            _exploder = explodingRigidbody;
        }
    }
}
