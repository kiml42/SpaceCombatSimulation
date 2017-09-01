using Assets.src.interfaces;
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
        public bool UntagChildren = true;
        public string DeadObjectTag = "Untagged";
        
        public IExploder Exploder;

        /// <summary>
        /// if true, completely kills the object and it's children, without severing attached children.
        /// </summary>
        public bool KillCompletely = false;

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
                if (KillCompletely)
                {
                    DestroyWithoutLookingForParent(child.gameObject, false);
                } else
                {
                    child.SendMessage("Deactivate", SendMessageOptions.DontRequireReceiver);
                    var rigidbody = child.GetComponent("Rigidbody") as Rigidbody;
                    child.parent = null;
                    if (UntagChildren)
                    {
                        //Debug.Log("untagging " + child);
                        child.tag = DeadObjectTag;
                    }

                    if (rigidbody != null)
                    {
                        //Debug.Log("Severing " + rigidbody.name);
                        rigidbody.angularDrag = 0;
                        var fixedJoint = child.GetComponent("FixedJoint") as FixedJoint;
                        if (fixedJoint != null)
                        {
                            UnityEngine.Object.Destroy(fixedJoint);
                        }
                        var hingeJoint = child.GetComponent("HingeJoint") as HingeJoint;
                        if (hingeJoint != null)
                        {
                            UnityEngine.Object.Destroy(fixedJoint);
                        }
                        if(fixedJoint==null && hingeJoint == null)
                        {
                            //destroy anything that wasnt jointed to this object.
                            DestroyWithoutLookingForParent(child.gameObject, false);
                        }
                    }
                    else
                    {
                        DestroyWithoutLookingForParent(child.gameObject, false);
                    }
                }
            }

            if (useExplosion && Exploder != null)
            {
                var rigidBodyToExplode = toDestroy.GetComponent<Rigidbody>();
                Exploder.SetExplodingObject(rigidBodyToExplode);
                Exploder.ExplodeNow();
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
