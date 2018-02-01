using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class SpawnTurret : MonoBehaviour, IKnowsEnemyTags
{
    public TargetChoosingMechanism EnemyTagSource;
    public IKnowsEnemyTags _enemyTagSource;
    public bool TagChildren = false;


    #region EnemyTags
    void IKnowsEnemyTags.AddEnemyTag(string newTag)
    {
        var tags = EnemyTags;
        tags.Add(newTag);
        EnemyTags = tags.Distinct().ToList();
    }

    List<string> IKnowsEnemyTags.EnemyTags
    {
        get
        {
            return EnemyTags;
        }
        set
        {
            EnemyTags = value;
        }
    }

    public List<string> EnemyTags;
    #endregion

    public Transform TurretPrefab;

	// Use this for initialization
	void Start () {

        if(EnemyTagSource == null && transform.parent != null)
        {
            _enemyTagSource = transform.parent.GetComponent<IKnowsEnemyTags>();
        }
        else
        {
            _enemyTagSource = EnemyTagSource;
        }

        if(_enemyTagSource != null)
        {
            EnemyTags = _enemyTagSource.EnemyTags;
        }

        var turret = Instantiate(TurretPrefab, transform.position, transform.rotation, transform);
        if(transform.parent != null)
        {
            var parentRigidbody = transform.parent.GetComponent<Rigidbody>();
            var turretRigidbody = turret.parent.GetComponent<Rigidbody>();
            if(parentRigidbody != null && turretRigidbody != null)
            {
                turretRigidbody.velocity = parentRigidbody.velocity;
            }

            turret.parent = transform.parent;
            turret.GetComponent<FixedJoint>().connectedBody = transform.parent.GetComponent<Rigidbody>();

            var renderer = transform.parent.GetComponent("Renderer") as Renderer;

            if (renderer != null)
            {
                //Debug.Log("has renderer");
                turret.transform.SetColor(renderer.material.color);
            }
        }

        var tagKnower = turret.GetComponent<IKnowsEnemyTags>();
        if(tagKnower != null)
        {
            tagKnower.EnemyTags = EnemyTags;
        }

        if (TagChildren) {
            turret.tag = tag;
        }


        Destroy(gameObject);
    }
}
