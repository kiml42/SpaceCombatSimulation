using Assets.Src.Interfaces;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Src.ObjectManagement
{
    public class WithChildrenDestroyer : IDestroyer
    {
        public Rigidbody ExplosionEffect;
        public float ExplosionForce = 1000;
        public float ExplosionRadius = 1000;
        public bool UntagChildren = true;
        private Rigidbody deathExplosion;
        public string DeadObjectTag = "Untagged";

        public void Destroy(GameObject toDestroy, bool useExplosion)
        {
            //Debug.Log("Destroy called for " + toDestroy.name + ", useExplosion = " + useExplosion);
            toDestroy = FindNextParentRigidbody(toDestroy);
            //Debug.Log("Parent to destroy: " + toDestroy.name);
            DestroyWithoutLookingForParent(toDestroy, useExplosion);
        }

        private void DestroyWithoutLookingForParent(GameObject toDestroy, bool useExplosion)
        {
            var allChilldren = FindImediateChildren(toDestroy);
            foreach (var child in allChilldren)
            {
                child.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
                var rigidbody = child.GetComponent("Rigidbody") as Rigidbody;
                child.parent = null;
                var behaviour = child.GetComponent("Behaviour") as Behaviour;

                if (behaviour != null)
                {
                    behaviour.enabled = false;
                }
                if (UntagChildren)
                {
                    child.tag = DeadObjectTag;
                }

                if (rigidbody != null)
                {
                    //Debug.Log("Severing " + rigidbody.name);
                    rigidbody.angularDrag = 0;
                    var fixedJoint = child.GetComponent("FixedJoint") as FixedJoint;
                    if (fixedJoint != null)
                    {
                        fixedJoint.breakTorque = 0;
                        fixedJoint.breakForce = 0;
                    }
                    var hingeJoint = child.GetComponent("HingeJoint") as HingeJoint;
                    if (hingeJoint != null)
                    {
                        hingeJoint.breakTorque = 0;
                        hingeJoint.breakForce = 0;
                    }
                    if (useExplosion)
                    {
                        rigidbody.AddExplosionForce(ExplosionForce, toDestroy.transform.position, ExplosionRadius);
                    }
                }
                else
                {
                    DestroyWithoutLookingForParent(child.gameObject, false);
                }
            }

            if (useExplosion && ExplosionEffect != null)
            {
                var rigidBodyToExplode = toDestroy.GetComponent<Rigidbody>();
                var explosion = GameObject.Instantiate(ExplosionEffect, rigidBodyToExplode.position, rigidBodyToExplode.rotation);
                explosion.velocity = rigidBodyToExplode.velocity;
            }

            GameObject.Destroy(toDestroy);
        }

        private IEnumerable<Transform> FindImediateChildren(GameObject parent)
        {
            var children = new List<Transform>();
            var childCount = parent.transform.childCount;
            if(childCount > 0)
            {
            for(int i =0; i<childCount; i++)
                {
                    var child = parent.transform.GetChild(i);
                    children.Add(child);
                    //var subChildren = FindAllChildren(parent);
                    //children.AddRange(subChildren);
                }
            }
            return children;
        }

        private GameObject FindNextParentRigidbody(GameObject thing)
        {
            var rb = thing.GetComponent("Rigidbody") as Rigidbody;

            if(rb != null || thing.transform.parent == null)
            {
                //this thing has a rigidbody or has no parent, so should be treated as the highest level thing to be destroyed.
                return thing;
            }
            return FindNextParentRigidbody(thing.transform.parent.gameObject);
        }
    }
}
