using System;
using Assets.Src.Interfaces;
using UnityEngine;
using System.Linq;

namespace Assets.Src.Targeting
{
    public class ProximityDetonator : IDetonator
    {
        private readonly MonoBehaviour _thisExploder;
        private readonly float _detonationDistance;
        private Rigidbody _shrapnel;
        private int _shrapnelCOunt;
        public float ExplosionForce = 30;
        private readonly Rigidbody _explosionEffect;
        private string ExplodableTag;
        public string EnemyTag;
        public bool SetEnemyTagOnShrapnel = false;
        public bool TagShrapnel = false;

        public ProximityDetonator(MonoBehaviour thisExploder, float detonationDistance, Rigidbody shrapnel, Rigidbody explosionEffect, string explodableTag, int shrapnelCount = 50)
        {
            _thisExploder = thisExploder;
            _detonationDistance = detonationDistance;
            _shrapnel = shrapnel;
            _shrapnelCOunt = shrapnelCount;
            _explosionEffect = explosionEffect;
            ExplodableTag = explodableTag;
        }

        public void AutoDetonate(PotentialTarget target)
        {
            if (ShouldDetonate(target))
            {
                DetonateNow();
            }
        }

        private bool ShouldDetonate(PotentialTarget target)
        {
            if(target == null || target.Target == null)
            {
                return false;
            }
            var distance = target.DistanceToTurret(_thisExploder.transform);
            return distance <= _detonationDistance;
        }

        public void DetonateNow()
        {
            var exploderRigidbody = _thisExploder.GetComponent<Rigidbody>();

            //list all existing objects to be exploded.
            var gameObjects = GameObject
                .FindGameObjectsWithTag(ExplodableTag)
                .Where(g => g.GetComponent("Rigidbody") != null)
                .Select(g => g.GetComponent<Rigidbody>())
                .ToList();

            //add shrapnel to be exploded
            if (_shrapnelCOunt > 0)
            {
                for (int i = 0; i < _shrapnelCOunt; i++)
                {
                    var location = UnityEngine.Random.insideUnitSphere;
                    var fragment = UnityEngine.Object.Instantiate(_shrapnel, exploderRigidbody.position + location, exploderRigidbody.transform.rotation);
                    fragment.velocity = exploderRigidbody.velocity + (0.3f * ExplosionForce * location);
                    //gameObjects.Add(fragment);

                    if (SetEnemyTagOnShrapnel && !string.IsNullOrEmpty(EnemyTag))
                    {
                        fragment.SendMessage("SetEnemyTag", EnemyTag);
                    }

                    if (TagShrapnel)
                    {
                        fragment.tag = _thisExploder.tag;
                    }
                }
            }
            
            //explode everything.
            foreach (var fragment in gameObjects)
            {
                fragment.AddExplosionForce(ExplosionForce, exploderRigidbody.position, 100);
            }

            if(_explosionEffect != null)
            {
                var explosion = UnityEngine.Object.Instantiate(_explosionEffect, exploderRigidbody.position, UnityEngine.Random.rotation);
                explosion.velocity = exploderRigidbody.velocity;
            }

            GameObject.Destroy(_thisExploder.gameObject);

        }
    }
}